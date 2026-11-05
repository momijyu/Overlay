import { readRequest, withLocalTransaction } from "./localDatabase";
import { applyDriveLibrary, readLibraryState, registerLibrarySource, type getLibraryScope } from "./driveLibraryLocal";
import { LibraryRetry, entityKey, LIBRARY_EVENT_BYTES, LIBRARY_EVENT_LIMIT, mergeLibraryEvents, readLibraryEvent,
  type LibraryEntity, type LibraryEventRow, type LibraryScope } from "./driveLibraryData";
import { DRIVE_NOTE_FIELDS, driveId, driveObject } from "./googleDriveNoteData";
import type { DriveNoteAccess } from "./googleDriveNotes";
import { DriveHttpError } from "./driveHttpError";
import { sha256 } from "./driveAutosaveRemote";
import type { DriveBinding } from "./driveOutbox";
const FOLDER = "application/vnd.google-apps.folder";
const roles = new Set(["library-folder", "library-note"]);
function managed(value: unknown, scope: { rootId: string }, role: string, key?: string) {
  const file = driveObject(value); const props = driveObject(file.appProperties);
  if (file.ownedByMe !== true || file.trashed !== false || props.overlayApp !== "overlay" || props.overlaySchema !== "1"
    || props.overlayRootId !== scope.rootId || props.overlayRole !== role || key !== undefined && props.overlayEntityKey !== key
    || !Array.isArray(file.parents) || file.parents.length !== 1) throw new Error("Drive階層の所有者・保存場所を確認できませんでした。");
  driveId(file.id); driveId(file.parents[0]); return file;
}
export async function verifyLibraryAncestry(access: DriveNoteAccess, value: Record<string, unknown>, rootId: string) {
  let file = value; const visited = new Set<string>();
  for (let depth = 0; depth < 101; depth++) {
    if (!Array.isArray(file.parents) || file.parents.length !== 1) break;
    const id = driveId(file.parents[0]); if (id === rootId) return;
    if (visited.has(id)) break; visited.add(id);
    const parent = driveObject(await access.json(`files/${id}`, { fields: DRIVE_NOTE_FIELDS }));
    const role = driveObject(parent.appProperties).overlayRole;
    if (typeof role !== "string" || !roles.has(role)) break;
    file = managed(parent, { rootId }, role);
    if (file.mimeType !== FOLDER) break;
  }
  throw new Error("Driveノートが専用フォルダの外へ移動されています。自動作成せず停止しました。");
}
async function metadata(access: DriveNoteAccess, id: string) {
  try { return await access.json(`files/${driveId(id)}`, { fields: DRIVE_NOTE_FIELDS }); }
  catch (error) { if (error instanceof DriveHttpError && error.status === 404) return null; throw error; }
}
async function reserve(access: DriveNoteAccess, count: number) {
  const data = driveObject(await access.json("files/generateIds", { count: String(count), space: "drive", type: "files", fields: "ids" }));
  if (!Array.isArray(data.ids) || data.ids.length !== count || new Set(data.ids).size !== count) throw new Error("Drive階層のIDを準備できませんでした。");
  return data.ids.map(driveId);
}
async function preparePending(access: DriveNoteAccess) {
  const state = await readLibraryState(); const missing = state.entities.filter((row) => !row.entry.remoteId);
  const waiting = state.events.filter((row) => !row.sent && !row.fileId);
  if (!missing.length && !waiting.length) return state;
  const needsHistory = waiting.length > 0 && !state.scope?.historyId;
  const ids: string[] = [];
  for (let count = missing.length + waiting.length + (needsHistory ? 1 : 0); count > 0; count -= Math.min(count, 1000)) ids.push(...await reserve(access, Math.min(count, 1000)));
  await withLocalTransaction(["driveEntities", "driveTreeEvents", "driveSettings"], "readwrite", async (tx) => {
    const entities = tx.objectStore("driveEntities"); const events = tx.objectStore("driveTreeEvents");
    if (needsHistory) await readRequest(tx.objectStore("driveSettings").put({ id: "library", value: { ...state.scope, historyId: ids.shift()! } }));
    const locations = new Map<string, string>();
    for (const old of missing) {
      const row = await readRequest<LibraryEntity>(entities.get(old.id));
      if (!row) throw new Error("階層が変更されました。");
      const remoteId = row.entry.remoteId ?? ids.shift()!;
      locations.set(row.id, remoteId); await readRequest(entities.put({ ...row, entry: { ...row.entry, remoteId } }));
    }
    for (const row of await readRequest<LibraryEventRow[]>(events.getAll())) {
      if (row.sent) continue;
      const event = { ...row.event, changes: row.event.changes.map((change) => ({ ...change, entry: { ...change.entry,
        remoteId: change.entry.remoteId ?? locations.get(entityKey(change.entry)) } })) };
      const fileId = row.fileId ?? ids.shift();
      if (!fileId || event.changes.some((c) => !c.entry.remoteId)) throw new LibraryRetry("準備中に階層が変更されました。再確認します。");
      await readRequest(events.put({ ...row, event, fileId }));
    }
  }, false);
  return readLibraryState();
}
async function fetchEvents(access: DriveNoteAccess, scope: LibraryScope, cached: LibraryEventRow[]) {
  const files: Record<string, unknown>[] = []; let token: string | undefined;
  const tokens = new Set<string>();
  do {
    const data = driveObject(await access.json("files", { spaces: "drive", corpora: "user", pageSize: "1000", fields: `files(${DRIVE_NOTE_FIELDS}),nextPageToken,incompleteSearch`,
      q: `trashed = false and 'me' in owners and appProperties has { key='overlayApp' and value='overlay' } and appProperties has { key='overlayRole' and value='tree-event' } and appProperties has { key='overlayRootId' and value='${driveId(scope.rootId)}' }`, ...(token ? { pageToken: token } : {}) }));
    if (data.incompleteSearch || !Array.isArray(data.files) || data.files.length > 1000) throw new Error("Drive階層の一覧を取得しきれませんでした。");
    files.push(...data.files.map((f) => managed(f, scope, "tree-event")));
    if (files.length > LIBRARY_EVENT_LIMIT) throw new Error("Drive階層の履歴が確認上限を超えています。既存データは変更していません。");
    token = data.nextPageToken === undefined ? undefined : String(data.nextPageToken);
    if (token && (token.length > 4096 || tokens.has(token))) throw new Error("Drive階層の一覧の続き情報が不正です。");
    if (token) tokens.add(token);
  } while (token);
  if (new Set(files.map((f) => f.id)).size !== files.length) throw new Error("Drive階層のファイルIDが重複しています。");
  const results: LibraryEventRow[] = []; let offset = 0;
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
    for (;;) {
      const file = files[offset++]; if (!file) return;
      if (file.mimeType !== "application/json" || !Number.isSafeInteger(Number(file.size)) || Number(file.size) <= 0 || Number(file.size) > LIBRARY_EVENT_BYTES) throw new Error("Drive階層の履歴サイズが不正です。");
      const props = driveObject(file.appProperties); const eventId = driveId(props.overlayEventId);
      const previous = cached.find((r) => r.id === eventId);
      if (previous?.sent && (previous.fileId !== file.id || previous.hash !== file.sha256Checksum)) throw new Error("保存済みのDrive階層履歴が変更されています。同期を停止しました。");
      if (previous && previous.fileId === file.id && previous.hash === file.sha256Checksum) { results.push({ ...previous, sent: true }); continue; }
      const blob = await access.download(String(file.id), LIBRARY_EVENT_BYTES);
      const hash = await sha256(blob);
      if (blob.size !== Number(file.size) || hash !== file.sha256Checksum || hash !== props.overlayHash) throw new Error("Drive階層の履歴を検証できませんでした。");
      const event = readLibraryEvent(JSON.parse(await blob.text()));
      if (event.id !== eventId) throw new Error("Drive階層の履歴IDが一致しません。");
      if (previous && JSON.stringify(previous.event) !== JSON.stringify(event)) throw new Error("Drive階層の送信結果が一致しません。");
      results.push({ id: event.id, event, fileId: String(file.id), hash, sent: true });
    }
  }));
  for (const row of cached) if (row.sent && !results.some((r) => r.id === row.id)) throw new Error("Drive階層の履歴が削除されたか、アクセスできません。作り直さず停止しました。");
  return results;
}
async function createOnce(access: DriveNoteAccess, id: string, create: () => Promise<unknown>) {
  try { return await create(); } catch (error) {
    if (!(error instanceof DriveHttpError) || error.status !== 409) throw error;
    const value = await metadata(access, id); if (!value) throw error; return value;
  }
}
async function listLibraryObjects(access: DriveNoteAccess, scope: LibraryScope) {
  const result = new Map<string, unknown>(); let pageToken: string | undefined;
  const seen = new Set<string>();
  do {
    const data = driveObject(await access.json("files", { spaces: "drive", corpora: "user", pageSize: "1000",
      fields: `files(${DRIVE_NOTE_FIELDS}),nextPageToken,incompleteSearch`,
      q: `trashed = false and 'me' in owners and mimeType = '${FOLDER}' and appProperties has { key='overlayApp' and value='overlay' } and appProperties has { key='overlayRootId' and value='${driveId(scope.rootId)}' }`,
      ...(pageToken ? { pageToken } : {}) }));
    if (data.incompleteSearch || !Array.isArray(data.files) || data.files.length > 1000) throw new Error("Driveフォルダの一覧を取得しきれませんでした。");
    for (const file of data.files) {
      const value = driveObject(file); const id = driveId(value.id);
      if (result.has(id)) throw new Error("DriveフォルダのIDが重複しています。");
      result.set(id, file);
    }
    if (result.size > 20000) throw new Error("Driveフォルダが確認上限を超えています。");
    pageToken = data.nextPageToken === undefined ? undefined : String(data.nextPageToken);
    if (pageToken && (seen.has(pageToken) || pageToken.length > 4096)) throw new Error("Driveフォルダの続き情報が不正です。");
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return result;
}
async function arrange(access: DriveNoteAccess, scope: LibraryScope, merged: Map<string, LibraryEntity>, events: LibraryEventRow[]) {
  if (!access.updateMetadata) throw new Error("Driveの階層移動に対応していません。");
  const objects = await listLibraryObjects(access, scope);
  const remaining = [...merged.values()].filter((r) => !r.entry.deleted); const done = new Set<string>();
  while (remaining.length) {
    const index = remaining.findIndex((r) => r.entry.parentId === null || done.has(`folder:${r.entry.parentId}`));
    if (index < 0) throw new Error("移動先の階層を確認できません。");
    const row = remaining.splice(index, 1)[0]; const entry = row.entry;
    const parent = entry.parentId === null ? scope.rootId : merged.get(`folder:${entry.parentId}`)!.entry.remoteId!;
    const role = entry.kind === "folder" ? "library-folder" : "library-note";
    // 公開済みの実体を見失っても、新規IDで作り直さない。
    const known = events.some((e) => e.sent && e.event.changes.some((c) => entityKey(c.entry) === row.id));
    const old = objects.get(entry.remoteId!) ?? (known ? null : await metadata(access, entry.remoteId!));
    if (!old && known) throw new Error("保存済みのDriveフォルダが見つかりません。作り直さず停止しました。");
    const props = { overlayApp: "overlay", overlaySchema: "1", overlayRole: role, overlayRootId: scope.rootId, overlayEntityKey: row.id };
    const value = old ?? await createOnce(access, entry.remoteId!, () => access.json("files", { fields: DRIVE_NOTE_FIELDS }, {
      id: entry.remoteId, name: entry.name, mimeType: FOLDER, parents: [parent], appProperties: props }));
    let file = managed(value, scope, role, row.id);
    if (file.id !== entry.remoteId || file.mimeType !== FOLDER) throw new Error("Drive階層の保存先が一致しません。");
    if (file.name !== entry.name || (file.parents as string[])[0] !== parent) {
      const positions = events.flatMap((e) => e.event.changes).filter((c) => entityKey(c.entry) === row.id).map((c) => c.entry);
      const permittedNames = new Set(positions.map((e) => e.name));
      const permittedParents = new Set(positions.map((e) => e.parentId === null ? scope.rootId : merged.get(`folder:${e.parentId}`)?.entry.remoteId));
      if (!permittedNames.has(String(file.name)) || !permittedParents.has((file.parents as string[])[0])) throw new Error("Drive上でフォルダが直接変更されています。端末の状態で上書きせず停止しました。");
      file = managed(await access.updateMetadata(entry.remoteId!, { name: entry.name }, (file.parents as string[])[0] === parent ? {} : {
        addParents: parent, removeParents: (file.parents as string[])[0] }), scope, role, row.id);
      if (file.name !== entry.name || (file.parents as string[])[0] !== parent) throw new Error("Driveフォルダの移動結果を確認できません。");
    }
    done.add(row.id);
    // 各端末の本文コンテナも、同じ論理ノートの中へ集める。IDと本文は維持する。
    for (const source of row.sources) {
      const container = driveObject(objects.get(source.containerId));
      const properties = driveObject(container.appProperties);
      if (container.id !== source.containerId || container.mimeType !== FOLDER || properties.overlayNoteKey !== source.noteKey) throw new Error("Driveノートの保存先を確認できません。");
      managed(container, scope, "note-container");
      const previous = (container.parents as string[])[0];
      if (previous !== entry.remoteId) {
        if (previous !== scope.rootId) throw new Error("Driveノートが別の場所へ移動されています。自動で戻さず停止しました。");
        const moved = managed(await access.updateMetadata(source.containerId, {}, { addParents: entry.remoteId!, removeParents: previous }), scope, "note-container");
        if ((moved.parents as string[])[0] !== entry.remoteId) throw new Error("Driveノートの移動を確認できません。");
      }
    }
    if (entry.kind === "note") await withLocalTransaction(["driveBindings"], "readwrite", async (tx) => {
      const store = tx.objectStore("driveBindings"); const binding = await readRequest<DriveBinding | undefined>(store.get(entry.id));
      if (binding && binding.accountId === scope.accountId && binding.rootId === scope.rootId) await readRequest(store.put({ ...binding, parentId: entry.remoteId }));
    }, false);
  }
}

function publicationOrder(events: LibraryEventRow[]) {
  const result = events.filter((r) => r.sent); const pending = events.filter((r) => !r.sent);
  const completed = new Set(result.map((r) => r.id));
  const roots = new Map<string, string>();
  for (const row of events) for (const change of row.event.changes) if (change.before === null) roots.set(entityKey(change.entry), row.id);
  while (pending.length) {
    const index = pending.findIndex((row) => {
      const dependencies = row.event.changes.flatMap((c) => c.before === null ? [] : Array.isArray(c.before) ? c.before : [c.before]);
      for (const change of row.event.changes) if (change.entry.parentId) {
        const root = roots.get(`folder:${change.entry.parentId}`); if (root && root !== row.id) dependencies.push(root);
      }
      if (row.event.source) { const root = roots.get(`note:${row.event.source.logicalId}`); if (root) dependencies.push(root); }
      return dependencies.every((id) => completed.has(id));
    });
    if (index < 0) throw new Error("Drive階層の公開順序が不正です。");
    const row = pending.splice(index, 1)[0]; completed.add(row.id); result.push(row);
  }
  return result;
}
export async function syncDriveLibrary(access: DriveNoteAccess, connection: NonNullable<Awaited<ReturnType<typeof getLibraryScope>>>) {
  const bindings = await (await import("./driveOutbox")).listDriveBindings();
  const before = await readLibraryState();
  for (const binding of bindings) if (binding.uploadedGeneration > 0 && binding.accountId === connection.accountId && binding.rootId === connection.rootId) {
    const summary = before.entities.find((r) => r.id === `note:${binding.id}`);
    if (summary && !summary.entry.deleted) {
      const source = await withLocalTransaction(["noteSummaries"], "readonly", (tx) => readRequest<{ fileName: string } | undefined>(tx.objectStore("noteSummaries").get(binding.id)));
      if (source) await registerLibrarySource(binding, source.fileName);
    }
  }
  const state = await preparePending(access); const scope = state.scope;
  if (!scope || scope.accountId !== connection.accountId || scope.rootId !== connection.rootId) throw new Error("階層の連携先が一致しません。");
  const remote = await fetchEvents(access, scope, state.events);
  const events = publicationOrder([...remote, ...state.events.filter((r) => !remote.some((v) => v.id === r.id))]);
  const merged = mergeLibraryEvents(events.map((r) => r.event));
  // 競合がないことを確認してから物理フォルダを移動する。履歴は最後に公開する。
  await arrange(access, scope, merged, events);
  if (events.some((r) => !r.sent)) {
    if (!scope.historyId) throw new Error("階層履歴の保存先がありません。");
    const existing = await metadata(access, scope.historyId);
    if (!existing && scope.historyCreated) throw new Error("Driveの管理フォルダが削除されています。作り直さず停止しました。");
    const history = managed(existing ?? await createOnce(access, scope.historyId, () => access.json("files", { fields: DRIVE_NOTE_FIELDS }, {
      id: scope.historyId, name: `.Overlay管理-${scope.deviceId.slice(0, 8)}`, mimeType: FOLDER, parents: [scope.rootId],
      appProperties: { overlayApp: "overlay", overlaySchema: "1", overlayRole: "library-history", overlayRootId: scope.rootId },
    })), scope, "library-history");
    if (history.id !== scope.historyId || history.mimeType !== FOLDER || (history.parents as string[])[0] !== scope.rootId) throw new Error("階層履歴の保存先が変更されています。");
    scope.historyCreated = true;
    await withLocalTransaction(["driveSettings"], "readwrite", async (tx) => { await readRequest(tx.objectStore("driveSettings").put({ id: "library", value: scope })); }, false);
  }
  for (const row of events) {
    if (row.sent) continue;
    const data = new Blob([JSON.stringify(readLibraryEvent(row.event))], { type: "application/json" });
    if (data.size > LIBRARY_EVENT_BYTES) throw new Error("Drive階層の変更が大きすぎます。");
    const hash = await sha256(data);
    const saved = managed(await createOnce(access, row.fileId!, () => access.upload({ id: row.fileId, name: `.overlay-tree-${row.id}.json`,
      mimeType: "application/json", parents: [scope.historyId!], appProperties: { overlayApp: "overlay", overlaySchema: "1", overlayRole: "tree-event",
        overlayRootId: scope.rootId, overlayEventId: row.id, overlayHash: hash } }, data)), scope, "tree-event");
    if (saved.id !== row.fileId || saved.sha256Checksum !== hash || Number(saved.size) !== data.size) throw new Error("Drive階層の送信結果を確認できませんでした。");
    row.sent = true; row.hash = hash;
    // 一件ごとに記録。途中で閉じても成功済みを再作成しない。
    await withLocalTransaction(["driveTreeEvents"], "readwrite", async (tx) => { await readRequest(tx.objectStore("driveTreeEvents").put(row)); }, false);
  }
  await applyDriveLibrary(scope, merged, events);
}
