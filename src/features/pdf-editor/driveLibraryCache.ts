import { readRequest, withLocalTransaction } from "./localDatabase";
import { getLibraryScope } from "./driveLibraryLocal";
import type { LibraryEntity, LibrarySource } from "./driveLibraryData";
import { queueDriveCacheCheck } from "./driveCacheChecks";
import { DEFAULT_DRIVE_CACHE_MB, readDriveCacheLimit } from "./driveCacheSettings";
import type { DriveBinding } from "./driveOutbox";
import type { NoteBackup } from "./noteBackupData";
import { toLocalNoteSummary } from "./localNoteSummary";
import { getGoogleDriveSession } from "./googleDriveSession";
import { loadDriveNoteDetails } from "./googleDriveNotes";
import { driveNoteSummary, driveObject, DRIVE_NOTE_FIELDS } from "./googleDriveNoteData";

export const DRIVE_CACHE_LIMIT = DEFAULT_DRIVE_CACHE_MB * 1_000_000;
export const DRIVE_CACHE_RETENTION_MS = 30 * 60 * 1000;
const activeNotes = new Map<string, number>();
// Web Locksはクラッシュでも自動解放される。別タブで開いているノートも整理対象にしない。
export function pinDriveNote(id: string) {
  activeNotes.set(id, (activeNotes.get(id) ?? 0) + 1); let release: (() => void) | undefined; let closed = false;
  if (typeof navigator !== "undefined" && navigator.locks) void navigator.locks.request(`overlay-note-use-${id}`, { mode: "shared" }, () =>
    new Promise<void>((resolve) => { if (closed) resolve(); else release = resolve; })).catch(() => { /* ロック失敗時もこの画面の本文は保護する。整理側はロックを取得できた場合だけ動く。 */ });
  return () => {
    if (closed) return;
    closed = true;
    const remaining = (activeNotes.get(id) ?? 1) - 1;
    if (remaining > 0) { activeNotes.set(id, remaining); release?.(); }
    else {
      activeNotes.delete(id);
      // 長時間開いたノートも、閉じた時点から保持時間を数える。
      void touch(id).catch(() => { /* 本文は変更しない。失敗しても既存の保存内容を残す。 */ }).finally(() => release?.());
    }
  };
}
export class DriveVersionRequired extends Error {
  noteId: string; title: string; sources: LibrarySource[];
  constructor(noteId: string, title: string, sources: LibrarySource[]) {
    super("別端末の編集があります。開く版を選んでください。"); this.name = "DriveVersionRequired";
    this.noteId = noteId; this.title = title; this.sources = sources;
  }
}
export async function markUploadedCache(binding: DriveBinding, backup: NoteBackup, version?: string) {
  if (!binding.ids) return;
  await withLocalTransaction(["driveEntities", "driveBindings", "notes"], "readwrite", async (tx) => {
    const current = await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(binding.id));
    const store = tx.objectStore("driveEntities"); const row = await readRequest<LibraryEntity | undefined>(store.get(`note:${binding.id}`));
    if (!row || row.entry.deleted || !current || current.key !== binding.key || current.generation !== binding.generation) return;
    const note = await readRequest(tx.objectStore("notes").get(binding.id));
    await readRequest(store.put({ ...row, cachedSource: binding.ids!.note, cachedVersion: version,
      cacheWarning: undefined, cachedBytes: backup.notes[0].pdf.size + new Blob([JSON.stringify(note)]).size, lastUsed: row.lastUsed ?? Date.now() }));
  }, false);
}
export async function hydrateDriveNote(id: string, sourceId?: string, preferCached = false, allowCached = false) {
  const initial = await withLocalTransaction(["driveEntities", "driveBindings", "notes", "pdfs"], "readonly", async (tx) => ({
    entity: await readRequest<LibraryEntity | undefined>(tx.objectStore("driveEntities").get(`note:${id}`)),
    binding: await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(id)),
    hasBody: !!await readRequest(tx.objectStore("notes").getKey(id)) && !!await readRequest(tx.objectStore("pdfs").getKey(id)),
  }));
  const { entity, binding } = initial;
  if (!entity) return;
  if (entity.entry.deleted) throw new Error("このノートはDriveの一覧から削除されています。");
  // 端末の未送信内容を、取得した別端末の本文で置き換えない。
  if (binding && binding.generation > binding.uploadedGeneration && initial.hasBody) {
    if (sourceId && sourceId !== binding.ids?.note) throw new Error("未送信の変更があります。Driveへの保存後に版を選び直してください。");
    return;
  }
  if (!entity.sources.length) {
    if (initial.hasBody) return;
    throw new Error("Driveへの初回保存が完了していません。");
  }
  // 一括書き出しは、利用者が既に選んだ版を使う。未知の版を勝手に選ばない。
  if (preferCached && !sourceId && initial.hasBody && entity.sources.some((source) => source.noteId === entity.cachedSource)) sourceId = entity.cachedSource;
  if (!sourceId && entity.sources.length > 1) {
    const scope = await getLibraryScope(); const session = getGoogleDriveSession(); const connection = session.getConnection();
    const sources = [...entity.sources];
    if (scope && connection?.root && connection.account.id === scope.accountId && connection.root.id === scope.rootId) {
      const access = await session.drive.autosaveAccess(scope.accountId, scope.rootId);
      for (let offset = 0; offset < sources.length; offset += 4) {
        const group = await Promise.all(sources.slice(offset, offset + 4).map(async (source) => {
          const file = driveNoteSummary(await access.json(`files/${source.noteId}`, { fields: DRIVE_NOTE_FIELDS }), scope.rootId);
          if (file.id !== source.noteId || file.noteKey !== source.noteKey || file.deviceId !== source.deviceId) throw new Error("Driveの編集版を確認できませんでした。");
          return { ...source, updatedAt: file.updatedAt };
        }));
        sources.splice(offset, group.length, ...group);
      }
    }
    throw new DriveVersionRequired(id, entity.entry.name, sources);
  }
  const source = sourceId ? entity.sources.find((s) => s.noteId === sourceId) : entity.sources[0];
  if (!source) throw new Error("選択したDriveの版が見つかりません。");
  // 選択済みのキャッシュを先に返す。通信は別処理で検証し、本文を自動で置換しない。
  if (allowCached && !sourceId && initial.hasBody && !entity.cacheWarning
    && entity.cachedSource === source.noteId && entity.cachedVersion) {
    await touch(id);
    queueDriveCacheCheck(id, entity);
    return;
  }
  const scope = await getLibraryScope(); const session = getGoogleDriveSession(); const connection = session.getConnection();
  if (!scope || !connection?.root || connection.account.id !== scope.accountId || connection.root.id !== scope.rootId) {
    if (initial.hasBody && entity.cachedSource === source.noteId) return;
    throw new Error("このノートを開くには、連携したGoogle Driveへ接続してください。");
  }
  const access = await session.drive.autosaveAccess(scope.accountId, scope.rootId);
  const metadata = driveObject(await access.json(`files/${source.noteId}`, { fields: DRIVE_NOTE_FIELDS }));
  if (metadata.id !== source.noteId || metadata.ownedByMe !== true || metadata.trashed !== false) throw new Error("Driveノートの取得先を確認できません。");
  const version = String(metadata.version);
  if (initial.hasBody && entity.cachedSource === source.noteId && entity.cachedVersion === version) {
    await touch(id); return;
  }
  const result = await loadDriveNoteDetails(access, scope.rootId, source.noteId, metadata);
  if (result.summary.noteKey !== source.noteKey || result.summary.containerId !== source.containerId || result.summary.deviceId !== source.deviceId
    || String(result.metadata.version) !== version) throw new Error("取得中にDriveノートが変わりました。再度開いてください。");
  if (source.pdfHash && result.pdfHash !== source.pdfHash || binding?.ids?.note === source.noteId && binding.pdfHash && result.pdfHash !== binding.pdfHash) throw new Error("Driveの元PDFが変更されています。端末の内容を残して停止しました。");
  // 既に送信済みの自分の版が外部から変更されていたら、ローカルの正しい本文を保持する。
  if (binding?.ids?.note === source.noteId && binding.uploadedHash && result.manifest.sync?.hash !== binding.uploadedHash) throw new Error("Driveの保存内容が変更されています。端末の内容を残して停止しました。");
  const note = result.backup.notes[0];
  await withLocalTransaction(["notes", "pdfs", "noteSummaries", "driveEntities", "driveBindings"], "readwrite", async (tx) => {
    const entities = tx.objectStore("driveEntities");
    const current = await readRequest<LibraryEntity | undefined>(entities.get(`note:${id}`));
    const liveBinding = await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(id));
    // hash計算など通信以外の非IDB awaitをトランザクションへ持ち込まない。
    if (JSON.stringify({ entity: current, binding: liveBinding }) !== JSON.stringify({ entity, binding })) throw new Error("取得中にノートが変更されました。再度開いてください。");
    const previous = await readRequest<{ revision?: number } | undefined>(tx.objectStore("notes").get(id));
    const stored = { id, title: entity.entry.name, folderId: entity.entry.parentId, fileName: note.fileName, updatedAt: result.summary.updatedAt,
      revision: (previous?.revision ?? 0) + 1, strokesByPage: note.strokesByPage, textsByPage: note.textsByPage, pages: note.pages, headingsByPage: note.headingsByPage };
    await readRequest(tx.objectStore("pdfs").put({ id, blob: note.pdf }));
    await readRequest(tx.objectStore("notes").put(stored));
    await readRequest(tx.objectStore("noteSummaries").put(toLocalNoteSummary(stored)));
    await readRequest(entities.put({ ...entity, cachedSource: source.noteId, cachedVersion: version,
      cacheWarning: undefined, cachedBytes: note.pdf.size + new Blob([JSON.stringify(stored)]).size, lastUsed: Date.now() }));
    // 別端末の版を選んだ場合も旧送信先を上書きしない。次の編集で新しい枝を作る。
    if (liveBinding && liveBinding.ids?.note !== source.noteId) await readRequest(tx.objectStore("driveBindings").delete(id));
  }, false);
}
async function touch(id: string) {
  await withLocalTransaction(["driveEntities"], "readwrite", async (tx) => {
    const store = tx.objectStore("driveEntities"); const row = await readRequest<LibraryEntity | undefined>(store.get(`note:${id}`));
    if (row) await readRequest(store.put({ ...row, lastUsed: Date.now() }));
  }, false);
}

export async function pruneDriveCache(options: { now?: number; activeIds?: Set<string>; lock?: (id: string, work: () => Promise<void>) => Promise<void> } = {}) {
  const now = options.now ?? Date.now(); let removed = 0;
  const { rows, limitBytes } = await withLocalTransaction(["driveEntities", "driveSettings"], "readonly", async (tx) => ({
    rows: await readRequest<LibraryEntity[]>(tx.objectStore("driveEntities").getAll()),
    limitBytes: await readDriveCacheLimit(tx) * 1_000_000,
  }));
  let bytes = rows.reduce((sum, row) => sum + (row.cachedBytes ?? 0), 0);
  for (const candidate of rows.sort((a, b) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0))) {
    if (!candidate.cachedBytes || !candidate.cachedSource || !candidate.sources.some((s) => s.noteId === candidate.cachedSource)
      || bytes <= limitBytes && now - (candidate.lastUsed ?? now) < DRIVE_CACHE_RETENTION_MS) continue;
    if (activeNotes.has(candidate.entry.id) || options.activeIds?.has(candidate.entry.id)) continue;
    const work = async () => {
      await withLocalTransaction(["notes", "pdfs", "driveEntities", "driveBindings"], "readwrite", async (tx) => {
        const store = tx.objectStore("driveEntities"); const row = await readRequest<LibraryEntity | undefined>(store.get(candidate.id));
        const binding = await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(candidate.entry.id));
        if (!row || row.head !== candidate.head || row.lastUsed !== candidate.lastUsed || row.cachedSource !== candidate.cachedSource
          || binding && (binding.error || binding.generation !== binding.uploadedGeneration || binding.ids?.note !== row.cachedSource)
          || activeNotes.has(candidate.entry.id)) return;
        await readRequest(tx.objectStore("notes").delete(row.entry.id)); await readRequest(tx.objectStore("pdfs").delete(row.entry.id));
        await readRequest(store.put({ ...row, cachedBytes: 0, cachedVersion: undefined })); removed++; bytes -= row.cachedBytes ?? 0;
      }, false);
    };
    if (options.lock) await options.lock(candidate.entry.id, work);
    else if (typeof navigator !== "undefined" && navigator.locks) await navigator.locks.request(`overlay-note-use-${candidate.entry.id}`, { ifAvailable: true }, async (lock) => { if (lock) await work(); });
  }
  return removed;
}

export async function readDriveCacheSummary() {
  return withLocalTransaction(["driveEntities", "driveSettings"], "readonly", async (tx) => {
    const rows = await readRequest<LibraryEntity[]>(tx.objectStore("driveEntities").getAll());
    return { limitMB: await readDriveCacheLimit(tx), bytes: rows.reduce((sum, row) => sum + (row.entry.deleted ? 0 : row.cachedBytes ?? 0), 0) };
  });
}
