import { readRequest, withLocalTransaction } from "./localDatabase";
import { readNoteBackup, type NoteBackup } from "./noteBackupData";
import type { LoadedNote } from "./types";
import type { VersionBase } from "./driveVersionData";

export type DriveBinding = {
  id: string; key: string; deviceId: string; accountId: string; rootId: string; enabled: boolean;
  generation: number; uploadedGeneration: number; dirtySince: number; changedAt: number;
  ids?: { container: string; pdf: string; note: string }; error?: string; retryAt?: number;
  parentId?: string;
  basedOn?: VersionBase;
  pdfHash?: string;
  uploadedHash?: string;
  // Googleのsha256Checksumと比較する、送信済みJSON全バイトのハッシュ。旧データでは未設定。
  uploadedChecksum?: string;
  uploadedJsonBytes?: number;
  // 本文とは独立した付箋索引。本文送信の待ち時間へ索引通信を加えない。
  stickyIndexId?: string;
  stickyIndexHash?: string;
  stickyIndexPending?: boolean;
  stickyIndexAttempt?: { hash: string; generation: number };
  failures?: number;
};
export const DRIVE_DEBOUNCE_MS = 2000;
export const DRIVE_MAX_WAIT_MS = 10000;

// 付箋索引の進行だけでは、本文取得中の競合や別の編集と判定しない。
export function driveBodyBindingSignature(binding: DriveBinding | undefined) {
  return JSON.stringify(binding && { ...binding, stickyIndexId: undefined, stickyIndexHash: undefined,
    stickyIndexPending: undefined, stickyIndexAttempt: undefined });
}

export async function dirtyDriveBinding(transaction: IDBTransaction, id: string, now = Date.now()) {
  const store = transaction.objectStore("driveBindings");
  const binding = await readRequest<DriveBinding | undefined>(store.get(id));
  if (!binding) return;
  if (!Number.isSafeInteger(binding.generation + 1)) throw new Error("Drive保存の更新番号が上限を超えています。");
  await readRequest(store.put({ ...binding, generation: binding.generation + 1, changedAt: now,
    dirtySince: binding.generation === binding.uploadedGeneration ? now : binding.dirtySince }));
}

export function listDriveBindings(): Promise<DriveBinding[]> {
  return withLocalTransaction(["driveBindings"], "readonly", (tx) => readRequest(tx.objectStore("driveBindings").getAll()));
}

export function getDriveBinding(id: string): Promise<DriveBinding | undefined> {
  return withLocalTransaction(["driveBindings"], "readonly", (tx) => readRequest(tx.objectStore("driveBindings").get(id)));
}

// 利用者が選んだ1件だけを登録する。同じノートの再有効化ではファイルIDを変えない。
export async function enableDriveAutosave(id: string, accountId: string, rootId: string): Promise<void> {
  await withLocalTransaction(["notes", "pdfs", "driveBindings", "driveSettings"], "readwrite", async (tx) => {
    if (!await readRequest(tx.objectStore("notes").get(id)) || !await readRequest(tx.objectStore("pdfs").getKey(id))) {
      throw new Error("先にノートへ書き込んで、ブラウザへの保存を完了してください。");
    }
    const store = tx.objectStore("driveBindings");
    const existing = await readRequest<DriveBinding | undefined>(store.get(id));
    if (existing) {
      if (existing.accountId !== accountId || existing.rootId !== rootId) throw new Error("このノートを連携したGoogleアカウントへ接続してください。");
      await readRequest(store.put({ ...existing, enabled: true, error: undefined, retryAt: undefined }));
      return;
    }
    const settings = tx.objectStore("driveSettings");
    const device = await readRequest<{ id: string; value: string } | undefined>(settings.get("device"));
    const deviceId = device?.value ?? crypto.randomUUID();
    if (!device) await readRequest(settings.add({ id: "device", value: deviceId }));
    const now = Date.now();
    await readRequest(store.add({ id, key: crypto.randomUUID(), deviceId, accountId, rootId, enabled: true,
      generation: 1, uploadedGeneration: 0, dirtySince: now, changedAt: now } satisfies DriveBinding));
  });
}

export async function updateDriveBinding(id: string, key: string, update: (binding: DriveBinding) => DriveBinding) {
  return withLocalTransaction(["driveBindings"], "readwrite", async (tx) => {
    const store = tx.objectStore("driveBindings");
    const current = await readRequest<DriveBinding | undefined>(store.get(id));
    if (!current || current.key !== key) return null; // 削除・再作成された待ち行列を復活させない。
    const next = update(current);
    await readRequest(store.put(next));
    return next;
  });
}

export async function captureDriveJob(id: string, key: string): Promise<{ binding: DriveBinding; backup: NoteBackup } | null> {
  return withLocalTransaction(["notes", "pdfs", "driveBindings"], "readonly", async (tx) => {
    const binding = await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(id));
    if (!binding || binding.key !== key || !binding.enabled || binding.generation <= binding.uploadedGeneration) return null;
    const note = await readRequest<(Omit<LoadedNote, "file"> & { title: string; fileName: string }) | undefined>(tx.objectStore("notes").get(id));
    const pdf = await readRequest<{ blob: Blob } | undefined>(tx.objectStore("pdfs").get(id));
    if (!note || !pdf) throw new Error("Drive保存に必要なノートが見つかりません。");
    const backup = readNoteBackup({ schemaVersion: note.images ? 5 : note.headingsByPage ? 4 : note.pages ? 3 : 1,
      kind: "note", name: note.title, folders: [], notes: [{ ...note, folderId: null, pdf: pdf.blob, textsByPage: note.textsByPage ?? {} }] });
    return { binding, backup };
  });
}

export function driveJobDue(binding: DriveBinding, now: number) {
  return binding.enabled && binding.generation > binding.uploadedGeneration && !binding.error
    && now >= (binding.retryAt ?? 0)
    && now >= Math.min(binding.changedAt + DRIVE_DEBOUNCE_MS, binding.dirtySince + DRIVE_MAX_WAIT_MS);
}
