import { libraryScope } from "./driveLibraryLocal";
import type { LibraryEntity, LibraryScope, LibrarySource } from "./driveLibraryData";
import { driveBodyBindingSignature, type DriveBinding } from "./driveOutbox";
import { driveManifestContent, sha256 } from "./driveAutosaveRemote";
import { BACKUP_LIMITS } from "./noteBackupData";
import { readRequest, withLocalTransaction } from "./localDatabase";
import { driveNoteSummary, driveObject, readDriveManifest, DRIVE_NOTE_FIELDS } from "./googleDriveNoteData";
import type { DriveNoteAccess } from "./googleDriveNotes";
import { notifyDriveQueue } from "./driveQueueEvents";

const RECHECK_MS = 30000;
type Checks = { pending: Set<string>; checked: Map<string, { signature: string; at: number }> };
const checks = new WeakMap<IDBFactory, Checks>();
function state() {
  let value = checks.get(indexedDB);
  if (!value) { value = { pending: new Set(), checked: new Map() }; checks.set(indexedDB, value); }
  return value;
}
const signature = (row: LibraryEntity) => JSON.stringify([row.head, row.cachedSource, row.cachedVersion]);
const listeners = new Set<(id: string, message: string) => void>();
export function subscribeDriveCacheIssue(listener: (id: string, message: string) => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function queueDriveCacheCheck(id: string, row: LibraryEntity) {
  const current = state(); const previous = current.checked.get(id);
  if (previous?.signature === signature(row) && Date.now() - previous.at < RECHECK_MS) return;
  if (!current.pending.has(id)) { current.pending.add(id); notifyDriveQueue(); }
}
export function hasDriveCacheChecks() { return typeof indexedDB !== "undefined" && state().pending.size > 0; }

// Driveのversionは本文以外でも増える。自端末の送信済み本文と一致する場合だけ、版番号を追従する。
async function matchesUploadedContent(access: DriveNoteAccess, scope: LibraryScope, source: LibrarySource,
  binding: DriveBinding | undefined, metadata: Record<string, unknown>) {
  if (!binding?.ids || !binding.uploadedHash || binding.accountId !== scope.accountId || binding.rootId !== scope.rootId
    || binding.ids.note !== source.noteId || binding.ids.container !== source.containerId || binding.key !== source.noteKey
    || binding.deviceId !== source.deviceId || binding.generation !== binding.uploadedGeneration) return false;
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > BACKUP_LIMITS.jsonBytes) throw new Error("Driveの編集情報のサイズが不正です。");
  if (/^[a-f0-9]{64}$/.test(binding.uploadedChecksum ?? "") && typeof metadata.sha256Checksum === "string"
    && metadata.sha256Checksum.toLowerCase() === binding.uploadedChecksum && size === binding.uploadedJsonBytes) return true;
  const data = await access.download(source.noteId, BACKUP_LIMITS.jsonBytes);
  if (data.size !== size) throw new Error("確認中にDriveの編集情報が変わりました。");
  const manifest = readDriveManifest(JSON.parse(await data.text()), binding.key);
  return manifest.sync?.deviceId === binding.deviceId && manifest.sync.generation === binding.uploadedGeneration
    && manifest.pdfId === binding.ids.pdf && manifest.sync.hash === binding.uploadedHash
    && await sha256(new Blob([JSON.stringify(driveManifestContent(manifest))])) === binding.uploadedHash;
}

// 表示後の更新確認だけを行う。PDF取得・本文置換・送信先の変更はしない。
export async function checkQueuedDriveCaches(access: DriveNoteAccess, scope: LibraryScope, active: () => boolean) {
  const current = state();
  for (const id of [...current.pending]) {
    if (!active()) return;
    current.pending.delete(id);
    const initial = await withLocalTransaction(["driveEntities", "driveBindings"], "readonly", async (tx) => ({
      row: await readRequest<LibraryEntity | undefined>(tx.objectStore("driveEntities").get(`note:${id}`)),
      binding: await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(id)),
    }));
    const { row, binding } = initial;
    const source = row?.sources.find((source) => source.noteId === row.cachedSource);
    if (!row || row.entry.deleted || !source || !row.cachedVersion || row.cacheWarning
      || binding && binding.generation > binding.uploadedGeneration) continue;
    try {
      const metadata = driveObject(await access.json(`files/${source.noteId}`, { fields: DRIVE_NOTE_FIELDS }));
      if (!active()) return;
      const summary = driveNoteSummary(metadata, scope.rootId);
      if (summary.id !== source.noteId || summary.noteKey !== source.noteKey || summary.containerId !== source.containerId
        || summary.deviceId !== source.deviceId) throw new Error("Driveノートの取得先を確認できませんでした。");
      let checkedRow = row;
      if (String(metadata.version) !== row.cachedVersion) {
        const matches = await matchesUploadedContent(access, scope, source, binding, metadata);
        const message = "Drive上でこのノートが更新されています。表示中の内容は保持しています。ノート一覧から開き直して確認してください。";
        const changed = await withLocalTransaction(["driveEntities", "driveBindings", "driveSettings"], "readwrite", async (tx) => {
          const liveScope = await libraryScope(tx);
          const store = tx.objectStore("driveEntities");
          const live = await readRequest<LibraryEntity | undefined>(store.get(row.id));
          const liveBinding = await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(id));
          if (!active() || liveScope?.accountId !== scope.accountId || liveScope.rootId !== scope.rootId
            || !live || live.entry.deleted || signature(live) !== signature(row)
            || driveBodyBindingSignature(liveBinding) !== driveBodyBindingSignature(binding)) return false;
          checkedRow = matches ? { ...live, cachedVersion: String(metadata.version) } : { ...live, cacheWarning: message };
          await readRequest(store.put(checkedRow)); return true;
        }, false);
        if (changed && !matches) for (const listener of listeners) listener(id, message);
      }
      // 検証済みの版だけを短期間共有する。新しい版の取得は利用者の再選択時。
      current.checked.set(id, { signature: signature(checkedRow), at: Date.now() });
    } catch {
      if (active()) for (const listener of listeners) listener(id, "Driveの更新を確認できませんでした。端末の内容は保持しています。");
    }
  }
}
