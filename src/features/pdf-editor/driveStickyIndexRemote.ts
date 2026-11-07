import { sha256 } from "./driveAutosaveRemote";
import { DriveHttpError } from "./driveHttpError";
import { readLibraryState } from "./driveLibraryLocal";
import type { LibraryEntity, LibraryScope, LibrarySource } from "./driveLibraryData";
import { updateDriveBinding } from "./driveOutbox";
import { applyStickyIndexes, captureStickyIndexes } from "./driveStickyIndexLocal";
import { readDriveStickyIndex, readStickyEntries, STICKY_INDEX_BYTES, type DriveStickyCache, type DriveStickyIndex } from "./driveStickyIndexData";
import { DRIVE_NOTE_FIELDS, driveId, driveObject, driveNoteSummary } from "./googleDriveNoteData";
import { readDriveSource, type DriveNoteAccess } from "./googleDriveNotes";
import { createStickyOutline } from "./stickyOutline";

const ROLE = "sticky-index";
const entryHash = (entries: DriveStickyIndex["entries"]) => sha256(new Blob([JSON.stringify(entries)]));
function indexFile(value: unknown, scope: LibraryScope, source: LibrarySource) {
  const file = driveObject(value); const props = driveObject(file.appProperties);
  if (file.ownedByMe !== true || file.trashed !== false || file.mimeType !== "application/json"
    || props.overlayApp !== "overlay" || props.overlaySchema !== "1" || props.overlayRole !== ROLE
    || props.overlayRootId !== scope.rootId || props.overlaySourceId !== source.noteId
    || props.overlayNoteKey !== source.noteKey || props.overlayDeviceId !== source.deviceId
    || !Array.isArray(file.parents) || file.parents.length !== 1 || file.parents[0] !== scope.rootId
    || !Number.isSafeInteger(Number(file.size)) || Number(file.size) <= 0 || Number(file.size) > STICKY_INDEX_BYTES
    || typeof file.sha256Checksum !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256Checksum)) {
    throw new Error("Driveの付箋索引の所有者・保存場所・サイズを確認できません。");
  }
  driveId(file.id); return file;
}
async function readIndex(access: DriveNoteAccess, file: Record<string, unknown>, source: LibrarySource) {
  const data = await access.download(String(file.id), STICKY_INDEX_BYTES);
  if (data.size !== Number(file.size) || await sha256(data) !== file.sha256Checksum) throw new Error("Driveの付箋索引の取得結果が一致しません。");
  return readDriveStickyIndex(JSON.parse(await data.text()), source);
}

// 本文送信と切り離し、階層一覧の更新時だけ公開する。ペンだけの編集では再送信しない。
export async function publishDriveStickyIndexes(access: DriveNoteAccess, scope: LibraryScope, active: () => boolean = () => true) {
  for (const { binding, summary } of await captureStickyIndexes(scope)) {
    if (!active()) return;
    const entries = readStickyEntries(summary.stickyNotes ?? []); const hash = await entryHash(entries);
    if (binding.stickyIndexId && binding.stickyIndexHash === hash && !binding.stickyIndexPending) continue;
    if (!access.replace) throw new Error("Driveの付箋索引を更新できません。");
    let id = binding.stickyIndexId;
    if (!id) {
      const result = driveObject(await access.json("files/generateIds", { count: "1", space: "drive", type: "files", fields: "ids" }));
      if (!Array.isArray(result.ids) || result.ids.length !== 1) throw new Error("Driveの付箋索引のIDを準備できません。");
      const reserved = driveId(result.ids[0]);
      const live = await updateDriveBinding(binding.id, binding.key, (row) => ({ ...row, stickyIndexId: row.stickyIndexId ?? reserved }));
      if (!live) continue;
      id = live.stickyIndexId!;
    }
    const source: LibrarySource = { logicalId: binding.id, noteId: binding.ids!.note, noteKey: binding.key,
      containerId: binding.ids!.container, deviceId: binding.deviceId, fileName: summary.fileName };
    const index: DriveStickyIndex = { schemaVersion: 1, kind: "overlay-sticky-index", logicalId: binding.id,
      sourceId: source.noteId, noteKey: binding.key, deviceId: binding.deviceId, generation: binding.uploadedGeneration, entries };
    const data = new Blob([JSON.stringify(index)], { type: "application/json" });
    if (data.size > STICKY_INDEX_BYTES) throw new Error("Driveの付箋索引が上限を超えています。");
    const checksum = await sha256(data);
    let existing: Record<string, unknown> | null = null;
    try { existing = indexFile(await access.json(`files/${id}`, { fields: DRIVE_NOTE_FIELDS }), scope, source); }
    catch (error) { if (!(error instanceof DriveHttpError && error.status === 404)) throw error; }
    if (existing && existing.id !== id) throw new Error("Driveの付箋索引の保存先IDが一致しません。");
    if (!existing && binding.stickyIndexHash) throw new Error("Driveの付箋索引が削除されています。作り直さず停止しました。");
    let same = false;
    if (existing) {
      const saved = await readIndex(access, existing, source); const previousHash = await entryHash(saved.entries);
      const ownAttempt = binding.stickyIndexPending && binding.stickyIndexAttempt?.hash === previousHash
        && binding.stickyIndexAttempt.generation === saved.generation;
      if (saved.generation > index.generation || previousHash !== hash && (saved.generation === index.generation || previousHash !== binding.stickyIndexHash && !ownAttempt)) {
        throw new Error("Driveの付箋索引が変更されています。端末の内容を残して停止しました。");
      }
      same = previousHash === hash;
    }
    if (!same) {
      if (!active()) return;
      // 応答を失った後で付箋を元に戻しても、古い公開済みハッシュだけで完了と判断しない。
      if (!await updateDriveBinding(binding.id, binding.key, (row) => ({ ...row, stickyIndexPending: true,
        stickyIndexAttempt: { hash, generation: index.generation } }))) continue;
      if (existing) await access.replace(id, data);
      else {
        try {
          await access.upload({ id, name: `.overlay-stickies-${source.noteId}.json`, mimeType: "application/json", parents: [scope.rootId],
            appProperties: { overlayApp: "overlay", overlaySchema: "1", overlayRole: ROLE, overlayRootId: scope.rootId,
              overlaySourceId: source.noteId, overlayNoteKey: source.noteKey, overlayDeviceId: source.deviceId } }, data);
        } catch (error) { if (!(error instanceof DriveHttpError && error.status === 409)) throw error; }
      }
      // 成功応答の消失でも予約したIDを再使用し、確認後だけ公開済みを記録する。
      const latest = indexFile(await access.json(`files/${id}`, { fields: DRIVE_NOTE_FIELDS }), scope, source);
      if (latest.id !== id || latest.sha256Checksum !== checksum || Number(latest.size) !== data.size) throw new Error("Driveの付箋索引の保存結果を確認できません。");
    }
    if (!active()) return;
    await updateDriveBinding(binding.id, binding.key, (row) => ({ ...row, stickyIndexHash: hash, stickyIndexPending: false, stickyIndexAttempt: undefined }));
  }
}

async function listFiles(access: DriveNoteAccess, scope: LibraryScope) {
  const files = new Map<string, Record<string, unknown>>(); const seen = new Set<string>(); let token: string | undefined;
  do {
    const result = driveObject(await access.json("files", { spaces: "drive", corpora: "user", pageSize: "1000",
      fields: `files(${DRIVE_NOTE_FIELDS}),nextPageToken,incompleteSearch`,
      q: `trashed = false and 'me' in owners and appProperties has { key='overlayApp' and value='overlay' } and appProperties has { key='overlayRootId' and value='${driveId(scope.rootId)}' } and (appProperties has { key='overlayRole' and value='${ROLE}' } or appProperties has { key='overlayRole' and value='sync-note' })`,
      ...(token ? { pageToken: token } : {}) }));
    if (!Array.isArray(result.files) || result.files.length > 1000 || result.incompleteSearch) throw new Error("Driveの付箋索引の一覧を取得しきれません。");
    for (const value of result.files) {
      const file = driveObject(value); const id = driveId(file.id);
      if (files.has(id)) throw new Error("Driveの付箋索引のIDが重複しています。");
      files.set(id, file);
    }
    if (files.size > 20000) throw new Error("Driveの付箋索引が確認上限を超えています。");
    if (result.nextPageToken !== undefined && (typeof result.nextPageToken !== "string" || !result.nextPageToken || result.nextPageToken.length > 4096 || seen.has(result.nextPageToken))) throw new Error("Driveの付箋索引の続き情報が不正です。");
    token = result.nextPageToken as string | undefined; if (token) seen.add(token);
  } while (token);
  return files;
}

// 旧ノートだけは編集JSONから生成する。1周期4件までで、PDFを取得しない。
export async function refreshDriveStickyIndexes(access: DriveNoteAccess, scope: LibraryScope, active: () => boolean = () => true) {
  if (!active()) return;
  const state = await readLibraryState();
  if (state.scope?.accountId !== scope.accountId || state.scope.rootId !== scope.rootId) throw new Error("付箋索引の連携先が変わりました。");
  const rows = state.entities.filter((r) => r.entry.kind === "note" && !r.entry.deleted && r.sources.length);
  if (!rows.length) return;
  const files = await listFiles(access, scope);
  const indexes = new Map<string, Record<string, unknown>>();
  const sources = new Map(rows.flatMap((r) => r.sources.map((s) => [s.noteId, s] as const)));
  for (const file of files.values()) {
    const props = driveObject(file.appProperties);
    if (props.overlayRole !== ROLE || !sources.has(String(props.overlaySourceId))) continue;
    const id = String(props.overlaySourceId);
    if (indexes.has(id)) throw new Error("同じ保存先の付箋索引が重複しています。自動統合せず停止しました。");
    indexes.set(id, indexFile(file, scope, sources.get(id)!));
  }
  const results = new Map(rows.map((r) => [r.id, [] as DriveStickyCache[]]));
  const jobs: { row: LibraryEntity; source: LibrarySource; file: Record<string, unknown>; legacy: boolean }[] = [];
  let legacyCount = 0;
  for (const row of rows) for (const source of row.sources) {
    const index = indexes.get(source.noteId); const file = index ?? files.get(source.noteId);
    if (!file) throw new Error("付箋索引に対応するDriveノートが見つかりません。");
    if (!index) {
      const note = driveNoteSummary(file, scope.rootId);
      if (note.noteKey !== source.noteKey || note.deviceId !== source.deviceId || note.containerId !== source.containerId) throw new Error("付箋の取得先が一致しません。");
    }
    const previous = row.stickyIndexes?.find((c) => c.sourceId === source.noteId);
    if (previous && previous.fileId === file.id && previous.checksum === file.sha256Checksum) {
      results.get(row.id)!.push(previous); continue;
    }
    if (!index && legacyCount++ >= 4) continue;
    jobs.push({ row, source, file, legacy: !index });
  }
  let offset = 0;
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    for (;;) {
      const job = jobs[offset++]; if (!job) return;
      if (!active()) return;
      const { row, source, file } = job;
      let entries; let generation;
      if (job.legacy) {
        const { manifest, pdfMetadata } = await readDriveSource(access, scope.rootId, source.noteId, file);
        if (source.pdfHash && pdfMetadata.sha256Checksum !== source.pdfHash) throw new Error("付箋の参照先の元PDFが変更されています。");
        const latest = driveObject(await access.json(`files/${source.noteId}`, { fields: DRIVE_NOTE_FIELDS }));
        if (latest.version !== file.version || latest.sha256Checksum !== file.sha256Checksum) throw new Error("付箋の取得中にDriveノートが変更されました。");
        entries = createStickyOutline(manifest.textsByPage, manifest.pages); generation = manifest.sync!.generation;
      } else {
        const index = await readIndex(access, file, source);
        entries = index.entries; generation = index.generation;
      }
      const previous = row.stickyIndexes?.find((c) => c.sourceId === source.noteId);
      if (previous && generation <= previous.generation && JSON.stringify(entries) !== JSON.stringify(previous.entries)) throw new Error("Driveの付箋索引の更新番号が一致しません。");
      // 旧本文から作った索引の世代は、ペンのみの更新でも進む。内容が同じなら巻き戻しと誤認しない。
      generation = Math.max(generation, previous?.generation ?? 0);
      results.get(row.id)!.push({ sourceId: source.noteId, fileId: String(file.id), checksum: String(file.sha256Checksum ?? ""), generation, entries });
    }
  }));
  for (const caches of results.values()) caches.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  if (active()) await applyStickyIndexes(scope, rows, results, active);
}
