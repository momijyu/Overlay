import { readRequest, withLocalTransaction } from "./localDatabase";
import { notifyLibraryChanged } from "./driveLibraryEvents";
import { getLibraryScope, libraryScope, recordVersionAdoption } from "./driveLibraryLocal";
import { activeDriveSources, adoptionSignature, sameSourceVersion, type SourceVersion } from "./driveVersionData";
import { readDriveVersions } from "./driveVersionRemote";
import type { LibraryEntity, LibrarySource } from "./driveLibraryData";
import { queueDriveCacheCheck } from "./driveCacheChecks";
import { DEFAULT_DRIVE_CACHE_MB, readDriveCacheLimit } from "./driveCacheSettings";
import { driveBodyBindingSignature, type DriveBinding } from "./driveOutbox";
import type { NoteBackup } from "./noteBackupData";
import { toLocalNoteSummary } from "./localNoteSummary";
import { getGoogleDriveSession } from "./googleDriveSession";
import { loadDriveNoteDetails } from "./googleDriveNotes";
import { driveObject, DRIVE_NOTE_FIELDS } from "./googleDriveNoteData";

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
  observed?: SourceVersion[]; heads: string[]; deviceId?: string; scope?: { accountId: string; rootId: string };
  constructor(noteId: string, title: string, sources: LibrarySource[], context?: { observed: SourceVersion[]; heads: string[]; scope: { accountId: string; rootId: string; deviceId: string } }) {
    super("異なる編集内容があります。今後使う内容を選んでください。"); this.name = "DriveVersionRequired";
    this.noteId = noteId; this.title = title; this.sources = sources;
    this.observed = context?.observed; this.heads = context?.heads ?? []; this.deviceId = context?.scope.deviceId; this.scope = context?.scope;
  }
}
export async function markUploadedCache(binding: DriveBinding, backup: NoteBackup, version?: string) {
  if (!binding.ids) return;
  await withLocalTransaction(["driveEntities", "driveBindings", "notes"], "readwrite", async (tx) => {
    const current = await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(binding.id));
    const store = tx.objectStore("driveEntities"); const row = await readRequest<LibraryEntity | undefined>(store.get(`note:${binding.id}`));
    if (!row || row.entry.deleted || !current || current.key !== binding.key || current.generation !== binding.generation) return;
    const note = await readRequest(tx.objectStore("notes").get(binding.id));
    await readRequest(store.put({ ...row, cachedSource: binding.ids!.note, cachedVersion: version, cachedChecksum: current.uploadedChecksum,
      cacheWarning: undefined, cachedBytes: backup.notes[0].pdf.size + new Blob([JSON.stringify(note)]).size, lastUsed: row.lastUsed ?? Date.now() }));
  }, false);
}
export async function hydrateDriveNote(id: string, sourceId?: string, preferCached = false, allowCached = false, acceptVersion?: DriveVersionRequired) {
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
    if (acceptVersion || sourceId && sourceId !== binding.ids?.note) throw new Error("未送信の変更があります。Driveへの保存後に版を選び直してください。");
    return;
  }
  if (!entity.sources.length) {
    if (initial.hasBody) return;
    throw new Error("Driveへの初回保存が完了していません。");
  }
  const known = activeDriveSources(entity);
  if (allowCached && !sourceId && !acceptVersion && entity.adoptions?.length === 1 && known.length === 1
    && initial.hasBody && !entity.cacheWarning && entity.cachedSource === known[0].noteId && entity.cachedVersion) {
    await touch(id); queueDriveCacheCheck(id, entity); return;
  }
  if (preferCached && !entity.adoptions?.length && !sourceId && initial.hasBody && entity.sources.some((s) => s.noteId === entity.cachedSource)) sourceId = entity.cachedSource;
  let versions = entity.sourceVersions ?? [];
  let refreshedSources = entity.sources;
  let checkedMetadata: Record<string, unknown> | undefined;
  if (entity.sources.length > 1 || acceptVersion) {
    const scope = await getLibraryScope(); const session = getGoogleDriveSession(); const connection = session.getConnection();
    if (scope && connection?.root && connection.account.id === scope.accountId && connection.root.id === scope.rootId) {
      const access = await session.drive.autosaveAccess(scope.accountId, scope.rootId);
      const checked = await readDriveVersions(access, scope, entity.sources);
      versions = checked.map((r) => r.version); refreshedSources = checked.map((r) => r.source);
      const candidates = activeDriveSources(entity, versions);
      if (acceptVersion) {
        if (acceptVersion.noteId !== id || !acceptVersion.sources.some((s) => s.noteId === sourceId)
          || !acceptVersion.observed || JSON.stringify(acceptVersion.heads.slice().sort()) !== JSON.stringify((entity.adoptions ?? []).map((h) => h.id).sort())
          || acceptVersion.scope?.accountId !== scope.accountId || acceptVersion.scope.rootId !== scope.rootId
          || versions.length !== acceptVersion.observed.length
          || versions.some((v) => !acceptVersion.observed!.some((old) => sameSourceVersion(old, v)))) {
          throw new DriveVersionRequired(id, entity.entry.name, refreshedSources.filter((s) => candidates.some((c) => c.noteId === s.noteId)),
            { observed: versions, heads: (entity.adoptions ?? []).map((h) => h.id), scope });
        }
      } else if (!sourceId && (candidates.length !== 1 || (entity.adoptions?.length ?? 0) > 1)) {
        throw new DriveVersionRequired(id, entity.entry.name, refreshedSources.filter((s) => candidates.some((c) => c.noteId === s.noteId)),
          { observed: versions, heads: (entity.adoptions ?? []).map((h) => h.id), scope });
      }
      if (!sourceId) sourceId = candidates[0]?.noteId;
      checkedMetadata = checked.find((r) => r.source.noteId === sourceId)?.metadata;
    } else if (!sourceId && entity.sources.length > 1) {
      // 切断中は、既に採用済みで確認済みの本文だけ使う。未知の版を勝手に選ばない。
      const candidates = activeDriveSources(entity);
      if (candidates.length !== 1 || candidates[0].noteId !== entity.cachedSource || !initial.hasBody) throw new Error("編集版を確認するにはGoogle Driveへ接続してください。");
      sourceId = candidates[0].noteId;
    }
  }
  // 一括書き出しも、採用が決まっていれば同じ内容を使う。
  if (preferCached && !sourceId && initial.hasBody && entity.sources.some((source) => source.noteId === entity.cachedSource)) sourceId = entity.cachedSource;
  const source = sourceId ? entity.sources.find((s) => s.noteId === sourceId) : entity.sources[0];
  if (!source) throw new Error("選択したDriveの版が見つかりません。");
  // 選択済みのキャッシュを先に返す。通信は別処理で検証し、本文を自動で置換しない。
  if (allowCached && !acceptVersion && initial.hasBody && !entity.cacheWarning
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
  const token = session.auth.getAccessToken();
  const metadata = checkedMetadata ?? driveObject(await access.json(`files/${source.noteId}`, { fields: DRIVE_NOTE_FIELDS }));
  if (metadata.id !== source.noteId || metadata.ownedByMe !== true || metadata.trashed !== false) throw new Error("Driveノートの取得先を確認できません。");
  const version = String(metadata.version);
  if (!acceptVersion && initial.hasBody && entity.cachedSource === source.noteId && entity.cachedVersion === version) {
    await touch(id); return;
  }
  const result = await loadDriveNoteDetails(access, scope.rootId, source.noteId, metadata, {
    readCachedPdf: () => withLocalTransaction(["pdfs"], "readonly", async (tx) =>
      (await readRequest<{ blob: Blob } | undefined>(tx.objectStore("pdfs").get(id)))?.blob),
  });
  if (result.summary.noteKey !== source.noteKey || result.summary.containerId !== source.containerId || result.summary.deviceId !== source.deviceId
    || String(result.metadata.version) !== version) throw new Error("取得中にDriveノートが変わりました。再度開いてください。");
  if (source.pdfHash && result.pdfHash !== source.pdfHash || binding?.ids?.note === source.noteId && binding.pdfHash && result.pdfHash !== binding.pdfHash) throw new Error("Driveの元PDFが変更されています。端末の内容を残して停止しました。");
  // 既に送信済みの自分の版が外部から変更されていたら、ローカルの正しい本文を保持する。
  if (binding?.ids?.note === source.noteId && binding.uploadedHash && result.manifest.sync?.hash !== binding.uploadedHash) throw new Error("Driveの保存内容が変更されています。端末の内容を残して停止しました。");
  if (acceptVersion) {
    const latest = await readDriveVersions(access, scope, entity.sources);
    if (latest.length !== versions.length || latest.some((r) => !versions.some((v) => sameSourceVersion(v, r.version)))) throw new Error("選択中に編集内容が更新されました。選び直してください。");
  }
  const note = result.backup.notes[0];
  await withLocalTransaction(["notes", "pdfs", "noteSummaries", "driveEntities", "driveBindings", "driveSettings", "driveTreeEvents"], "readwrite", async (tx) => {
    const liveScope = await libraryScope(tx);
    const liveConnection = session.getConnection();
    if (liveScope?.accountId !== scope.accountId || liveScope.rootId !== scope.rootId
      || liveConnection?.account.id !== scope.accountId || liveConnection.root?.id !== scope.rootId
      || session.auth.getAccessToken() !== token) throw new Error("連携先が変わりました。内容は採用していません。");
    const entities = tx.objectStore("driveEntities");
    const current = await readRequest<LibraryEntity | undefined>(entities.get(`note:${id}`));
    const liveBinding = await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(id));
    // hash計算など通信以外の非IDB awaitをトランザクションへ持ち込まない。
    if (JSON.stringify({ ...current, stickyIndexes: undefined }) !== JSON.stringify({ ...entity, stickyIndexes: undefined })
      || driveBodyBindingSignature(liveBinding) !== driveBodyBindingSignature(binding)) throw new Error("取得中にノートが変更されました。再度開いてください。");
    const previous = await readRequest<{ revision?: number } | undefined>(tx.objectStore("notes").get(id));
    const stored = { id, title: entity.entry.name, folderId: entity.entry.parentId, fileName: note.fileName, updatedAt: result.summary.updatedAt,
      revision: (previous?.revision ?? 0) + 1, strokesByPage: note.strokesByPage, textsByPage: note.textsByPage, pages: note.pages, headingsByPage: note.headingsByPage };
    await readRequest(tx.objectStore("pdfs").put({ id, blob: note.pdf }));
    await readRequest(tx.objectStore("notes").put(stored));
    await readRequest(tx.objectStore("noteSummaries").put(toLocalNoteSummary(stored)));
    const adopted = acceptVersion ? await recordVersionAdoption(tx, current!, { logicalId: id, sourceId: source.noteId,
      before: acceptVersion.heads, observed: versions }, adoptionSignature(entity)) : current;
    await readRequest(entities.put({ ...adopted, sourceVersions: versions, cachedSource: source.noteId, cachedVersion: version,
      cachedChecksum: typeof metadata.sha256Checksum === "string" ? metadata.sha256Checksum : undefined,
      cacheWarning: undefined, cachedBytes: note.pdf.size + new Blob([JSON.stringify(stored)]).size, lastUsed: Date.now() }));
    // 別端末の版を選んだ場合も旧送信先を上書きしない。次の編集で新しい枝を作る。
    if (liveBinding && liveBinding.ids?.note !== source.noteId) await readRequest(tx.objectStore("driveBindings").delete(id));
  }, false);
  notifyLibraryChanged();
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
  try {
    for (const candidate of rows.sort((a, b) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0))) {
      if (!candidate.cachedBytes || !candidate.cachedSource || !candidate.sources.some((s) => s.noteId === candidate.cachedSource)
        || bytes <= limitBytes && now - (candidate.lastUsed ?? now) < DRIVE_CACHE_RETENTION_MS) continue;
      if (activeNotes.has(candidate.entry.id) || options.activeIds?.has(candidate.entry.id)) continue;
      const work = async () => {
        const evictedBytes = await withLocalTransaction(["notes", "pdfs", "driveEntities", "driveBindings"], "readwrite", async (tx) => {
          const store = tx.objectStore("driveEntities"); const row = await readRequest<LibraryEntity | undefined>(store.get(candidate.id));
          const binding = await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(candidate.entry.id));
          if (!row || row.head !== candidate.head || row.lastUsed !== candidate.lastUsed || row.cachedSource !== candidate.cachedSource
            || binding && (binding.error || binding.generation !== binding.uploadedGeneration || binding.ids?.note !== row.cachedSource)
            || activeNotes.has(candidate.entry.id)) return null;
          await readRequest(tx.objectStore("notes").delete(row.entry.id)); await readRequest(tx.objectStore("pdfs").delete(row.entry.id));
          await readRequest(store.put({ ...row, cachedBytes: 0, cachedVersion: undefined }));
          return row.cachedBytes ?? 0;
        }, false);
        // 完了した削除だけを数える。途中で中断したトランザクションは通知しない。
        if (evictedBytes !== null) { removed++; bytes -= evictedBytes; }
      };
      if (options.lock) await options.lock(candidate.entry.id, work);
      else if (typeof navigator !== "undefined" && navigator.locks) await navigator.locks.request(`overlay-note-use-${candidate.entry.id}`, { ifAvailable: true }, async (lock) => { if (lock) await work(); });
    }
  } finally {
    // 後続の整理が失敗しても、既に完了した整理分は一覧と付箋へ反映する。
    if (removed) notifyLibraryChanged();
  }
  return removed;
}

export async function readDriveCacheSummary() {
  return withLocalTransaction(["driveEntities", "driveSettings"], "readonly", async (tx) => {
    const rows = await readRequest<LibraryEntity[]>(tx.objectStore("driveEntities").getAll());
    return { limitMB: await readDriveCacheLimit(tx), bytes: rows.reduce((sum, row) => sum + (row.entry.deleted ? 0 : row.cachedBytes ?? 0), 0) };
  });
}
