import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { PDFDocument } from "pdf-lib";
import { captureNoteBackup, createNoteFolder, deleteEmptyNoteFolder, deleteSavedItems, deleteSavedNote, loadLocalNote, loadNoteLibrary, moveNoteFolder, moveSavedItems, moveSavedNote, organizeNote, renameNoteFolder, saveLocalNote } from "@/features/pdf-editor/localNotes";
import { enableDriveLibrary, readLibraryState } from "@/features/pdf-editor/driveLibraryLocal";
import { syncDriveLibrary } from "@/features/pdf-editor/driveLibraryRemote";
import { mergeLibraryEvents, type LibraryEvent } from "@/features/pdf-editor/driveLibraryData";
import { createDriveAutosave } from "@/features/pdf-editor/driveAutosave";
import { listDriveBindings } from "@/features/pdf-editor/driveOutbox";
import { checkQueuedDriveCaches, hasDriveCacheChecks, subscribeDriveCacheIssue } from "@/features/pdf-editor/driveCacheChecks";
import { driveManifestContent } from "@/features/pdf-editor/driveAutosaveRemote";
import { sha256 } from "@/features/pdf-editor/driveAutosaveRemote";
import { DriveHttpError } from "@/features/pdf-editor/driveHttpError";
import { DRIVE_CACHE_LIMIT, DRIVE_CACHE_RETENTION_MS, DriveVersionRequired, pinDriveNote, pruneDriveCache } from "@/features/pdf-editor/driveLibraryCache";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
import { saveDriveCacheLimit } from "@/features/pdf-editor/driveCacheSettings";
import { getGoogleDriveSession } from "@/features/pdf-editor/googleDriveSession";
import type { DriveNoteAccess } from "@/features/pdf-editor/googleDriveNotes";
import { DriveVersionDialog } from "@/features/pdf-editor/components/DriveVersionDialog";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const connection = { accountId: "accountA", rootId: "rootA" };
const useDevice = (db = new IDBFactory()) => { Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: db }); return db; };
beforeEach(() => {
  useDevice(); mock.method(globalThis, "fetch", () => { throw new Error("実Googleへは接続しない"); });
});
afterEach(() => mock.restoreAll());
async function pdf() {
  const document = await PDFDocument.create(); document.addPage([600, 800]);
  return new File([new Uint8Array(await document.save())], "講義.pdf", { type: "application/pdf" });
}
function remote() {
  type Item = Record<string, unknown> & { id: string; name: string; appProperties: Record<string, string>; data?: Blob; parents: string[] };
  const files = new Map<string, Item>(); let serial = 0; const calls: string[] = [];
  let failRole: string | null = null;
  const save = async (input: Record<string, unknown>, data?: Blob) => {
    const id = String(input.id); if (files.has(id)) throw new DriveHttpError(409, "exists");
    const row = { ...input, id, name: String(input.name), parents: input.parents as string[], appProperties: input.appProperties as Record<string, string>, ownedByMe: true, trashed: false, modifiedTime: "2026-11-05T00:00:00Z", version: "1",
      ...(data ? { data, size: String(data.size), sha256Checksum: await sha256(data) } : {}) } as Item;
    files.set(id, row);
    if (row.appProperties.overlayRole === failRole) { failRole = null; throw new DriveHttpError(0, "送信直後に通信断"); }
    return row;
  };
  const access: DriveNoteAccess = {
    async json(path, parameters, body) {
      calls.push(`${body ? "POST" : "GET"} ${path}`);
      if (path === "files/generateIds") return { ids: Array.from({ length: Number(parameters.count) }, () => `g_${++serial}`) };
      if (path === "files" && body) return save(body as Record<string, unknown>);
      if (path === "files") {
        if (parameters.q.includes("mimeType = 'application/vnd.google-apps.folder'")) return { files: [...files.values()].filter((f) => !f.trashed && f.mimeType === "application/vnd.google-apps.folder" && f.appProperties.overlayRootId === connection.rootId) };
        const role = parameters.q.includes("tree-event") ? "tree-event" : "sync-note";
        return { files: [...files.values()].filter((f) => !f.trashed && f.appProperties.overlayRole === role && f.appProperties.overlayRootId === connection.rootId) };
      }
      const value = files.get(path.slice(6)); if (!value) throw new DriveHttpError(404, "missing"); return value;
    },
    async upload(input, data) { calls.push(`upload ${input.mimeType}`); return save(input, data); },
    async download(id) { calls.push(`download ${id}`); const row = files.get(id); if (!row?.data) throw new DriveHttpError(404, "missing"); return row.data; },
    async replace(id, data, metadata) {
      const previous = files.get(id)!; const row = { ...previous, ...metadata, data, size: String(data.size), sha256Checksum: await sha256(data), version: String(Number(previous.version) + 1) };
      files.set(id, row); return row;
    },
    async updateMetadata(id, metadata, parameters = {}) {
      calls.push(`move ${id}`); const row = files.get(id)!;
      const updated = { ...row, ...metadata, parents: parameters.addParents ? [parameters.addParents] : row.parents } as Item;
      files.set(id, updated); return updated;
    },
  };
  return { access, files, calls, failAfterSave(role: string) { failRole = role; } };
}
async function sync(f: ReturnType<typeof remote>) {
  const scope = (await readLibraryState()).scope!;
  await syncDriveLibrary(f.access, scope);
}
async function send(f: ReturnType<typeof remote>) {
  const runner = createDriveAutosave({ connection: () => connection, access: async () => f.access,
    lock: async (_name, work) => work(), now: () => Date.now() + 20000 });
  await runner.tick();
}
async function fixture() {
  const db = indexedDB as IDBFactory; const file = await pdf(); const parent = await createNoteFolder("2026", null);
  const folder = await createNoteFolder("情報", parent);
  const note = await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  await organizeNote(note, "ノート1", folder);
  await enableDriveLibrary(connection.accountId, connection.rootId);
  const f = remote(); await sync(f); await send(f); await sync(f);
  return { ...f, db, file, parent, folder, note };
}
function authorize(f: ReturnType<typeof remote>) {
  const session = getGoogleDriveSession();
  mock.method(session, "getConnection", () => ({ account: { id: connection.accountId, displayName: "", emailAddress: "test@example.com" }, root: { id: connection.rootId, name: "Overlay" } }));
  mock.method(session.drive, "autosaveAccess", async () => f.access);
}
async function bodyCount() {
  return withLocalTransaction(["notes", "pdfs"], "readonly", async (tx) => [await readRequest(tx.objectStore("notes").count()), await readRequest(tx.objectStore("pdfs").count())]);
}

test("未取得ノートは階層確認とJSON取得を並行し、確認前にPDFを取得しない", async () => {
  const f = await fixture(); authorize(f);
  await pruneDriveCache({ now: Date.now() + DRIVE_CACHE_RETENTION_MS + 1000, lock: async (_id, work) => work() });
  const source = (await readLibraryState()).entities.find((row) => row.entry.id === f.note)!.sources[0];
  const originalJson = f.access.json.bind(f.access); const originalDownload = f.access.download.bind(f.access);
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let jsonStarted!: () => void; const started = new Promise<void>((resolve) => { jsonStarted = resolve; });
  let locationPending = false; let pdfStarted = false; let metadataReads = 0;
  f.access.json = async (...args) => {
    if (args[0] === `files/${source.noteId}`) metadataReads++;
    if (args[0] === `files/${source.containerId}`) { locationPending = true; await gate; }
    return originalJson(...args);
  };
  f.access.download = async (...args) => {
    if (args[0] === source.noteId) jsonStarted(); else pdfStarted = true;
    return originalDownload(...args);
  };
  const loading = loadLocalNote(f.note);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([started, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("JSON取得が階層確認を待っている")), 2000); })]);
    assert.equal(locationPending, true); assert.equal(pdfStarted, false);
  } finally { clearTimeout(timer); release(); await loading; }
  assert.equal(pdfStarted, true);
  // 最初の情報を同じ操作内で共有し、2回目はPDF取得時の変更検出に使う。
  assert.equal(metadataReads, 2); assert.deepEqual(await bodyCount(), [1, 1]);
});

test("JSON取得中のDriveの版変更をPDF取得時に検出し、キャッシュを書き込まない", async () => {
  const f = await fixture(); authorize(f);
  await pruneDriveCache({ now: Date.now() + DRIVE_CACHE_RETENTION_MS + 1000, lock: async (_id, work) => work() });
  const source = (await readLibraryState()).entities.find((row) => row.entry.id === f.note)!.sources[0];
  const originalDownload = f.access.download.bind(f.access);
  f.access.download = async (...args) => {
    const data = await originalDownload(...args);
    if (args[0] === source.noteId) {
      const row = f.files.get(source.noteId)!;
      f.files.set(source.noteId, { ...row, version: String(Number(row.version) + 1) });
    }
    return data;
  };
  await assert.rejects(loadLocalNote(f.note), /取得中にDriveノートが変わりました/);
  assert.deepEqual(await bodyCount(), [0, 0]);
});

test("並行取得の階層検証失敗ではPDFとキャッシュを取得せず、次回の再取得は成功する", async () => {
  const f = await fixture(); authorize(f);
  await pruneDriveCache({ now: Date.now() + DRIVE_CACHE_RETENTION_MS + 1000, lock: async (_id, work) => work() });
  const source = (await readLibraryState()).entities.find((row) => row.entry.id === f.note)!.sources[0];
  const container = f.files.get(source.containerId)!;
  f.files.set(container.id, { ...container, parents: ["outside"] }); f.calls.length = 0;
  await assert.rejects(loadLocalNote(f.note));
  assert.ok(f.calls.filter((call) => call.startsWith("download ")).every((call) => call === `download ${source.noteId}`));
  assert.deepEqual(await bodyCount(), [0, 0]);
  f.files.set(container.id, container);
  await loadLocalNote(f.note); assert.deepEqual(await bodyCount(), [1, 1]);
});

test("全ノートと空フォルダを固定IDで連携し、初回PDF送信後も通常編集では元PDFを増やさない", async () => {
  const f = await fixture(); const before = (await readLibraryState()).entities;
  assert.equal(before.length, 3); assert.ok(before.every((e) => e.entry.remoteId));
  assert.ok(before.find((e) => e.entry.id === f.note)?.sources.length);
  const empty = await createNoteFolder("空", f.parent); await sync(f);
  const count = f.files.size;
  await saveLocalNote({ file: f.file, noteId: f.note, expectedRevision: 1, strokesByPage: { 1: [{ width: 2, points: [{ x: .2, y: .4 }] }] } });
  await send(f); await sync(f);
  assert.equal(f.files.size, count);
  assert.equal(f.calls.filter((c) => c === "upload application/pdf").length, 1);
  assert.ok((await readLibraryState()).entities.find((e) => e.entry.id === empty)?.entry.remoteId);
});

test("ノート・親フォルダの移動と改名は物理ID・本文IDを維持し、子の所属も維持する", async () => {
  const f = await fixture(); const original = (await readLibraryState()).entities;
  const target = await createNoteFolder("数学", null); await sync(f);
  await moveNoteFolder(f.folder, target); await renameNoteFolder(f.folder, "講義"); await sync(f);
  const moved = (await readLibraryState()).entities;
  assert.equal(moved.find((e) => e.entry.id === f.folder)?.entry.remoteId, original.find((e) => e.entry.id === f.folder)?.entry.remoteId);
  const parentRemote = moved.find((e) => e.entry.id === target)!.entry.remoteId!;
  const folderRemote = moved.find((e) => e.entry.id === f.folder)!.entry.remoteId!;
  assert.deepEqual(f.files.get(folderRemote)!.parents, [parentRemote]);
  assert.equal((await loadNoteLibrary()).notes[0].folderId, f.folder);
  await moveSavedNote(f.note, null); await sync(f);
  assert.equal((await readLibraryState()).entities.find((e) => e.entry.id === f.note)?.entry.remoteId, original.find((e) => e.entry.id === f.note)?.entry.remoteId);
});

test("初回応答を失っても同じ予約IDで再試行し、フォルダや履歴ファイルを重複作成しない", async () => {
  const folder = await createNoteFolder("講義", null); await enableDriveLibrary(connection.accountId, connection.rootId);
  const f = remote(); f.failAfterSave("tree-event"); await assert.rejects(sync(f), /通信断/);
  const count = f.files.size; await sync(f); assert.equal(f.files.size, count);
  assert.equal((await readLibraryState()).entities.find((e) => e.entry.id === folder)?.entry.name, "講義");
  assert.ok((await readLibraryState()).events.every((e) => e.sent));
});

test("保存済みのフォルダや不変の階層履歴が削除された場合、新規作成で埋めず停止する", async () => {
  const f = await fixture(); const entity = (await readLibraryState()).entities.find((r) => r.entry.id === f.folder)!;
  f.files.delete(entity.entry.remoteId!); const count = f.files.size;
  await assert.rejects(sync(f), /作り直さず停止/); assert.equal(f.files.size, count);
  assert.ok((await loadNoteLibrary()).folders.some((r) => r.id === f.folder));
});

test("階層変更と待ち行列の保存失敗では移動自体もロールバックする", async () => {
  const f = await fixture(); const put = IDBObjectStore.prototype.add;
  mock.method(IDBObjectStore.prototype, "add", function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
    if (this.name === "driveTreeEvents") throw new DOMException("full", "QuotaExceededError");
    return put.apply(this, args);
  });
  await assert.rejects(moveSavedNote(f.note, null), /容量が不足/);
  assert.equal((await loadNoteLibrary()).notes[0].folderId, f.folder);
});

test("別端末は一覧と階層だけ取得し、選択したノートだけを同じ論理IDで取得する", async () => {
  const f = await fixture(); useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId);
  const downloads = f.calls.filter((c) => c.startsWith("download")).length;
  await sync(f); assert.deepEqual(await bodyCount(), [0, 0]);
  assert.equal((await loadNoteLibrary()).notes[0].id, f.note);
  authorize(f); const note = await loadLocalNote(f.note); assert.equal(note.id, f.note);
  assert.deepEqual(await bodyCount(), [1, 1]); assert.equal((await listDriveBindings()).length, 0);
  const after = f.calls.filter((c) => c.startsWith("download")).length; assert.ok(after > downloads);
  await loadLocalNote(f.note); assert.equal(f.calls.filter((c) => c.startsWith("download")).length, after);
  await renameNoteFolder(f.folder, "講義"); assert.equal((await listDriveBindings()).length, 0);
});

test("本文の初回送信待ちの他端末ノートを、ローカルの階層操作で削除と誤認しない", async () => {
  const deviceA = indexedDB as IDBFactory;
  const note = await saveLocalNote({ file: await pdf(), noteId: null, strokesByPage: {} });
  await enableDriveLibrary(connection.accountId, connection.rootId);
  const f = remote(); await sync(f);
  const deviceB = useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId); await sync(f);
  assert.equal((await loadNoteLibrary()).notes.length, 0);
  await createNoteFolder("別端末のフォルダ", null); await sync(f);
  assert.equal((await readLibraryState()).entities.find((row) => row.entry.id === note)?.entry.deleted, undefined);
  useDevice(deviceA); await sync(f); await send(f); await sync(f);
  useDevice(deviceB); await sync(f);
  assert.equal((await loadNoteLibrary()).notes[0].id, note);
});

test("別端末の編集は独立した保存先へ送り、同じ論理ノートの版として選択できる", async () => {
  const f = await fixture(); const previous = (await listDriveBindings())[0].ids;
  useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId); await sync(f); authorize(f);
  const opened = await loadLocalNote(f.note);
  await saveLocalNote({ file: opened.file, noteId: f.note, expectedRevision: opened.revision, strokesByPage: { 1: [{ width: 2, points: [{ x: .4, y: .4 }] }] } });
  await sync(f); await send(f); await sync(f);
  assert.notEqual((await listDriveBindings())[0].ids?.note, previous?.note);
  const state = await readLibraryState(); assert.equal(state.entities.find((e) => e.entry.id === f.note)?.sources.length, 2);
  assert.equal((await loadNoteLibrary()).notes.length, 1);
  await assert.rejects(loadLocalNote(f.note), DriveVersionRequired);
  const restored = await loadLocalNote(f.note, { sourceId: previous!.note }); assert.deepEqual(restored.strokesByPage, {});
});

test("同じ基点からの二端末の移動は競合として止め、時刻やパスで片方を上書きしない", async () => {
  const f = await fixture(); const deviceB = useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId); await sync(f);
  await moveSavedNote(f.note, f.parent);
  useDevice(f.db); await moveSavedNote(f.note, null); await sync(f);
  useDevice(deviceB); const count = f.files.size;
  await assert.rejects(sync(f), /競合/); assert.equal(f.files.size, count);
  assert.equal((await loadNoteLibrary()).notes[0].folderId, f.parent);
  assert.ok((await readLibraryState()).events.some((e) => !e.sent));
});

test("PDF未取得ノートの一括移動も本文を取得せず、同じIDの所属だけを更新する", async () => {
  const f = await fixture(); useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId); await sync(f);
  await moveSavedItems([{ kind: "note", id: f.note }], null); await sync(f);
  assert.deepEqual(await bodyCount(), [0, 0]); assert.equal((await loadNoteLibrary()).notes[0].folderId, null);
});

test("同期済みの未使用本文だけを整理し、一覧・階層・Driveの実体は維持する", async () => {
  const f = await fixture(); const remoteCount = f.files.size;
  const count = await pruneDriveCache({ now: Date.now() + DRIVE_CACHE_RETENTION_MS + 1000, lock: async (_id, work) => work() });
  assert.equal(count, 1); assert.deepEqual(await bodyCount(), [0, 0]);
  assert.equal((await loadNoteLibrary()).notes[0].id, f.note); assert.equal(f.files.size, remoteCount);
  await sync(f); assert.ok(!(await readLibraryState()).entities.some((r) => r.entry.deleted));
  authorize(f); assert.equal((await loadLocalNote(f.note)).id, f.note);
});

test("未送信・保存失敗・編集中のノートはキャッシュ整理で削除しない", async () => {
  const f = await fixture(); const locked = { now: Date.now() + DRIVE_CACHE_RETENTION_MS + 1000, lock: async (_id: string, work: () => Promise<void>) => work() };
  assert.equal(await pruneDriveCache({ ...locked, activeIds: new Set([f.note]) }), 0);
  await saveLocalNote({ file: f.file, noteId: f.note, expectedRevision: 1, strokesByPage: {} });
  assert.equal(await pruneDriveCache(locked), 0); assert.deepEqual(await bodyCount(), [1, 1]);
});

test("初期上限250MBを超える再取得可能キャッシュは猶予時間内でも整理する", async () => {
  const f = await fixture();
  await withLocalTransaction(["driveEntities"], "readwrite", async (tx) => {
    const store = tx.objectStore("driveEntities"); const row = await readRequest<Record<string, unknown>>(store.get(`note:${f.note}`));
    await readRequest(store.put({ ...row, cachedBytes: DRIVE_CACHE_LIMIT + 1, lastUsed: Date.now() }));
  }, false);
  assert.equal(await pruneDriveCache({ lock: async (_id, work) => work() }), 1);
});

test("利用者の容量設定を整理処理へ反映し、上限を下げても未送信・使用中の内容は残す", async () => {
  const f = await fixture();
  await withLocalTransaction(["driveEntities"], "readwrite", async (tx) => {
    const store = tx.objectStore("driveEntities"); const row = await readRequest<Record<string, unknown>>(store.get(`note:${f.note}`));
    await readRequest(store.put({ ...row, cachedBytes: 300_000_000, lastUsed: Date.now() }));
  }, false);
  const lock = async (_id: string, work: () => Promise<void>) => work();
  await saveDriveCacheLimit(400); assert.equal(await pruneDriveCache({ lock }), 0);
  await saveDriveCacheLimit(100);
  assert.equal(await pruneDriveCache({ lock, activeIds: new Set([f.note]) }), 0);
  await saveLocalNote({ file: f.file, noteId: f.note, expectedRevision: 1, strokesByPage: {} });
  assert.equal(await pruneDriveCache({ lock }), 0); assert.deepEqual(await bodyCount(), [1, 1]);
  await send(f); await sync(f);
  await withLocalTransaction(["driveEntities"], "readwrite", async (tx) => {
    const store = tx.objectStore("driveEntities"); const row = await readRequest<Record<string, unknown>>(store.get(`note:${f.note}`));
    await readRequest(store.put({ ...row, cachedBytes: 300_000_000 }));
  }, false);
  assert.equal(await pruneDriveCache({ lock }), 1); assert.deepEqual(await bodyCount(), [0, 0]);
});

test("一覧から削除した項目は別端末でも復活せず、DriveのPDF自体は自動削除しない", async () => {
  const f = await fixture(); await deleteSavedNote(f.note); await deleteEmptyNoteFolder(f.folder); await sync(f);
  assert.ok([...f.files.values()].some((file) => file.mimeType === "application/pdf"));
  useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId); await sync(f);
  assert.equal((await loadNoteLibrary()).notes.length, 0); assert.ok(!(await loadNoteLibrary()).folders.some((r) => r.id === f.folder));
});

test("別アカウントへの階層の転送・混在を拒否する", async () => {
  await fixture(); await assert.rejects(enableDriveLibrary("other", connection.rootId), /別アカウント/);
});

function event(id: string, before: string | null, parentId: string | null = null): LibraryEvent {
  return { schemaVersion: 1, kind: "overlay-library-event", id, deviceId: "device", changes: [{ before, entry: { id: "folder", kind: "folder", name: "講義", parentId, remoteId: "physical" } }] };
}
test("欠落した基点・二重作成・物理IDの差し替えを階層の適用前に拒否する", () => {
  assert.throws(() => mergeLibraryEvents([event("b", "missing")]), /履歴が欠け/);
  assert.throws(() => mergeLibraryEvents([event("a", null), event("b", null)]), /競合/);
  const changed = event("b", "a"); changed.changes[0].entry.remoteId = "replacement";
  assert.throws(() => mergeLibraryEvents([event("a", null), changed]), /保存先ID/);
});
test("違うフォルダ同士の同時移動でできる循環や同名衝突も拒否する", () => {
  const a = event("a", null); const b = event("b", null);
  b.changes[0].entry = { ...b.changes[0].entry, id: "other", remoteId: "otherPhysical" };
  assert.throws(() => mergeLibraryEvents([a, b]), /同名/);
  a.changes[0].entry.parentId = "other"; b.changes[0].entry.parentId = "folder";
  assert.throws(() => mergeLibraryEvents([a, b]), /循環/);
});
test("版選択は端末ごとに表示し、キャンセルを備える", () => {
  const choice = new DriveVersionRequired("id", "講義", [{ logicalId: "id", noteId: "note", noteKey: "branch", containerId: "container", deviceId: "deviceA", fileName: "a.pdf" }]);
  const html = renderToStaticMarkup(createElement(DriveVersionDialog, { choice, onChoose() {}, onClose() {} }));
  assert.match(html, /開く版を選択/); assert.match(html, /端末 deviceA/); assert.match(html, /キャンセル/);
});

test("競合した移動は利用者が配置を選んで合流でき、同じ物理IDと両方の編集版を保持する", async () => {
  const { LibraryConflict } = await import("@/features/pdf-editor/driveLibraryData");
  const { resolveLibraryPlacement } = await import("@/features/pdf-editor/driveLibraryLocal");
  const f = await fixture(); const deviceB = useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId); await sync(f);
  await moveSavedNote(f.note, f.parent);
  useDevice(f.db); await moveSavedNote(f.note, null); await sync(f);
  useDevice(deviceB);
  let conflict: InstanceType<typeof LibraryConflict> | null = null;
  try { await sync(f); } catch (error) { if (error instanceof LibraryConflict) conflict = error; else throw error; }
  assert.ok(conflict);
  const choice = conflict.conflicts[0];
  const chosen = choice.versions.find((v) => v.entry.parentId === null)!;
  await resolveLibraryPlacement(choice, chosen.head); await sync(f);
  assert.equal((await loadNoteLibrary()).notes[0].folderId, null);
  assert.ok((await readLibraryState()).events.every((r) => r.sent));
  useDevice(f.db); await sync(f); assert.equal((await loadNoteLibrary()).notes[0].folderId, null);
});

test("PDFの追加先は選択したフォルダのIDで指定し、削除済みの追加先へは保存しない", async () => {
  const file = await pdf(); const folder = await createNoteFolder("講義", null);
  const note = await saveLocalNote({ file, noteId: null, strokesByPage: {}, initialFolderId: folder });
  assert.equal((await loadNoteLibrary()).notes.find((n) => n.id === note)?.folderId, folder);
  await assert.rejects(saveLocalNote({ file, noteId: null, strokesByPage: {}, initialFolderId: "missing" }), /追加先/);
  assert.equal((await loadNoteLibrary()).notes.length, 1);
});

test("DB版6の元PDF・編集本文・未送信番号を保持して版7へ更新する", async () => {
  const request = indexedDB.open("overlay-local-notes", 6);
  request.onupgradeneeded = () => {
    for (const name of ["notes", "pdfs", "folders", "noteSummaries", "driveBindings", "driveSettings"]) request.result.createObjectStore(name, { keyPath: "id" });
    request.transaction!.objectStore("driveBindings").add({ id: "pending", generation: 7, uploadedGeneration: 6 });
    request.transaction!.objectStore("pdfs").add({ id: "pending", blob: new Blob(["%PDF-original"]) });
  };
  const database = await readRequest(request); database.close();
  await withLocalTransaction(["driveBindings", "pdfs"], "readonly", async (tx) => {
    assert.equal(tx.db.version, 7);
    assert.deepEqual(await readRequest(tx.objectStore("driveBindings").get("pending")), { id: "pending", generation: 7, uploadedGeneration: 6 });
    assert.equal((await readRequest<{ blob: Blob }>(tx.objectStore("pdfs").get("pending"))).blob.size, 13);
  });
});

test("公開済みの階層履歴の改変・欠落では、端末の一覧を上書きしない", async () => {
  const f = await fixture(); const history = (await readLibraryState()).events.find((row) => row.event.changes.length)!;
  f.files.get(history.fileId!)!.sha256Checksum = "0".repeat(64);
  await assert.rejects(sync(f), /変更されています/);
  assert.equal((await loadNoteLibrary()).notes[0].folderId, f.folder);
});

test("キャッシュの削除途中で失敗しても元PDF・本文・一覧を全て残す", async () => {
  const f = await fixture(); const remove = IDBObjectStore.prototype.delete;
  mock.method(IDBObjectStore.prototype, "delete", function (this: IDBObjectStore, ...args: Parameters<typeof remove>) {
    if (this.name === "pdfs") throw new DOMException("failed", "UnknownError");
    return remove.apply(this, args);
  });
  await assert.rejects(pruneDriveCache({ now: Date.now() + DRIVE_CACHE_RETENTION_MS + 1000, lock: async (_id, work) => work() }), /保存場所へアクセス/);
  assert.deepEqual(await bodyCount(), [1, 1]); assert.equal((await loadNoteLibrary()).notes[0].id, f.note);
});

test("競合の確認後にさらに移動した場合は、古い選択で上書きしない", async () => {
  const { LibraryConflict } = await import("@/features/pdf-editor/driveLibraryData");
  const { resolveLibraryPlacement } = await import("@/features/pdf-editor/driveLibraryLocal");
  const f = await fixture(); const deviceB = useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId); await sync(f);
  await moveSavedNote(f.note, f.parent);
  useDevice(f.db); await moveSavedNote(f.note, null); await sync(f); useDevice(deviceB);
  let conflict: InstanceType<typeof LibraryConflict> | null = null;
  try { await sync(f); } catch (error) { if (error instanceof LibraryConflict) conflict = error; else throw error; }
  assert.ok(conflict); await moveSavedNote(f.note, f.folder);
  await assert.rejects(resolveLibraryPlacement(conflict.conflicts[0], conflict.conflicts[0].versions[0].head), /確認後に階層が変わりました/);
  assert.equal((await loadNoteLibrary()).notes[0].folderId, f.folder);
});


test("閲覧用キャッシュは他ノートの保存・復元や再接続では送信対象にせず、編集した1件だけ登録する", async () => {
  const f = await fixture(); useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId); await sync(f); authorize(f);
  const opened = await loadLocalNote(f.note);
  const other = await saveLocalNote({ file: f.file, noteId: null, strokesByPage: {} });
  await enableDriveLibrary(connection.accountId, connection.rootId);
  assert.deepEqual((await listDriveBindings()).map((row) => row.id), [other]);
  await saveLocalNote({ file: opened.file, noteId: f.note, expectedRevision: opened.revision, strokesByPage: {} });
  assert.deepEqual(new Set((await listDriveBindings()).map((row) => row.id)), new Set([other, f.note]));
});

test("複数版から選んで開いた内容をフォルダバックアップへ含め、未選択の版は勝手に選ばない", async () => {
  const f = await fixture(); const source = (await listDriveBindings())[0].ids!.note;
  useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId); await sync(f); authorize(f);
  const opened = await loadLocalNote(f.note);
  await saveLocalNote({ file: opened.file, noteId: f.note, expectedRevision: opened.revision, strokesByPage: { 1: [{ width: 2, points: [{ x: .4, y: .4 }] }] } });
  await sync(f); await send(f); await sync(f);
  useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId); await sync(f);
  await assert.rejects(captureNoteBackup({ kind: "folder", id: f.parent }), DriveVersionRequired);
  await loadLocalNote(f.note, { sourceId: source });
  const backup = await captureNoteBackup({ kind: "folder", id: f.parent });
  assert.equal(backup.notes.length, 1); assert.deepEqual(backup.notes[0].strokesByPage, {});
  assert.equal((await listDriveBindings()).length, 0);
});

test("初回本文送信待ちの子を持つフォルダは単独・一括どちらも削除せず、同期を継続できる", async () => {
  const deviceA = indexedDB as IDBFactory; const folder = await createNoteFolder("講義", null);
  const note = await saveLocalNote({ file: await pdf(), noteId: null, initialFolderId: folder, strokesByPage: {} });
  await enableDriveLibrary(connection.accountId, connection.rootId); const f = remote(); await sync(f);
  const deviceB = useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId); await sync(f);
  assert.equal((await loadNoteLibrary()).notes.length, 0);
  const before = await readLibraryState();
  await assert.rejects(deleteEmptyNoteFolder(folder), /初回送信中/);
  await assert.rejects(deleteSavedItems([{ kind: "folder", id: folder }]), /初回送信中/);
  assert.deepEqual(await readLibraryState(), before); await sync(f);
  useDevice(deviceA); await sync(f); await send(f); await sync(f);
  useDevice(deviceB); await sync(f);
  assert.equal((await loadNoteLibrary()).notes[0].id, note);
  assert.ok((await loadNoteLibrary()).folders.some((row) => row.id === folder));
});

test("通常の本文更新では全ノート・階層を走査せず、対象1件の保存と送信待ちを更新する", async () => {
  const f = await fixture(); const getAll = IDBObjectStore.prototype.getAll; const scanned: string[] = [];
  mock.method(IDBObjectStore.prototype, "getAll", function (this: IDBObjectStore, ...args: Parameters<typeof getAll>) {
    scanned.push(this.name); return getAll.apply(this, args);
  });
  await saveLocalNote({ file: f.file, noteId: f.note, expectedRevision: 1, strokesByPage: {} });
  assert.deepEqual(scanned, []);
  assert.equal((await listDriveBindings())[0].generation, 2);
});


test("キャッシュのある通常オープンはGoogle通信を待たず、裏の確認はまとめて1回だけ行う", async () => {
  const f = await fixture(); authorize(f); f.calls.length = 0;
  const scope = (await readLibraryState()).scope!;
  await loadLocalNote(f.note); await loadLocalNote(f.note);
  assert.equal(f.calls.length, 0); assert.equal(hasDriveCacheChecks(), true);
  await checkQueuedDriveCaches(f.access, scope, () => true);
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].startsWith("GET files/"));
  assert.equal(hasDriveCacheChecks(), false);
  await loadLocalNote(f.note); assert.equal(hasDriveCacheChecks(), false);
  assert.equal(f.calls.length, 1);
});

async function remoteEdit(f: Awaited<ReturnType<typeof fixture>>, sourceId: string) {
  const remote = f.files.get(sourceId)!;
  const manifest = JSON.parse(await remote.data!.text());
  manifest.strokesByPage = { 1: [{ width: 2, points: [{ x: .9, y: .8 }] }] };
  manifest.sync.generation++;
  manifest.sync.hash = await sha256(new Blob([JSON.stringify(driveManifestContent(manifest))]));
  const data = new Blob([JSON.stringify(manifest)], { type: "application/json" });
  await f.access.replace!(sourceId, data, {});
  return manifest.strokesByPage;
}

test("自分が保存した本文のままDriveの版番号だけが変わっても更新警告を出さない", async () => {
  const f = await fixture(); authorize(f);
  const binding = (await listDriveBindings())[0]; const sourceId = binding.ids!.note;
  const original = await loadLocalNote(f.note);
  const remote = f.files.get(sourceId)!;
  f.files.set(sourceId, { ...remote, version: "2" });
  f.calls.length = 0;
  const notices: string[] = []; const unsubscribe = subscribeDriveCacheIssue((_id, message) => notices.push(message));
  try {
    await checkQueuedDriveCaches(f.access, (await readLibraryState()).scope!, () => true);
    assert.deepEqual(notices, []);
    const entity = (await readLibraryState()).entities.find((row) => row.entry.id === f.note)!;
    assert.equal(entity.cacheWarning, undefined); assert.equal(entity.cachedVersion, "2");
    assert.deepEqual((await loadLocalNote(f.note)).strokesByPage, original.strokesByPage);
    assert.equal((await loadLocalNote(f.note)).revision, original.revision);
    assert.deepEqual((await listDriveBindings())[0], binding);
    assert.equal(f.calls.includes(`download ${binding.ids!.pdf}`), false);
    assert.equal(f.calls.includes(`download ${sourceId}`), false);
    assert.equal(hasDriveCacheChecks(), false);
  } finally { unsubscribe(); }
});

test("旧ノートの版番号差もチェックサムの保存情報なしで本文を検証して追従する", async () => {
  const f = await fixture(); authorize(f);
  const binding = (await listDriveBindings())[0];
  await withLocalTransaction(["driveBindings"], "readwrite", (tx) => readRequest(tx.objectStore("driveBindings").put({ ...binding, uploadedChecksum: undefined })));
  await loadLocalNote(f.note);
  f.files.set(binding.ids!.note, { ...f.files.get(binding.ids!.note)!, version: "2" }); f.calls.length = 0;
  await checkQueuedDriveCaches(f.access, (await readLibraryState()).scope!, () => true);
  const entity = (await readLibraryState()).entities.find((row) => row.entry.id === f.note)!;
  assert.equal(entity.cacheWarning, undefined); assert.equal(entity.cachedVersion, "2");
  assert.equal(f.calls.filter((call) => call.startsWith("download ")).length, 1);
});

test("通常の自動保存後は最新の送信版を使い、再選択でも更新警告を出さない", async () => {
  const f = await fixture(); authorize(f);
  const original = await loadLocalNote(f.note);
  const strokes = { 1: [{ width: 3, points: [{ x: .2, y: .4 }] }] };
  await saveLocalNote({ file: f.file, noteId: f.note, expectedRevision: original.revision, strokesByPage: strokes });
  await send(f);
  const binding = (await listDriveBindings())[0];
  assert.equal(binding.generation, binding.uploadedGeneration);
  f.calls.length = 0;
  const notices: string[] = []; const unsubscribe = subscribeDriveCacheIssue((_id, message) => notices.push(message));
  try {
    await loadLocalNote(f.note);
    await checkQueuedDriveCaches(f.access, (await readLibraryState()).scope!, () => true);
    assert.deepEqual(notices, []);
    assert.equal(f.calls.filter((call) => call.startsWith("download ")).length, 0);
    assert.deepEqual((await loadLocalNote(f.note)).strokesByPage, strokes);
  } finally { unsubscribe(); }
});

test("同じ端末・送信番号・ハッシュの自己申告でも実際の本文が違えば更新警告を残す", async () => {
  const f = await fixture(); authorize(f); const original = await loadLocalNote(f.note);
  const sourceId = (await listDriveBindings())[0].ids!.note;
  const manifest = JSON.parse(await f.files.get(sourceId)!.data!.text());
  manifest.strokesByPage = { 1: [{ width: 7, points: [{ x: .8, y: .1 }] }] };
  await f.access.replace!(sourceId, new Blob([JSON.stringify(manifest)]), {});
  const notices: string[] = []; const unsubscribe = subscribeDriveCacheIssue((_id, message) => notices.push(message));
  try {
    await checkQueuedDriveCaches(f.access, (await readLibraryState()).scope!, () => true);
    assert.match(notices[0], /Drive上でこのノートが更新/);
    const entity = (await readLibraryState()).entities.find((row) => row.entry.id === f.note)!;
    assert.equal(entity.cachedVersion, "1"); assert.match(entity.cacheWarning!, /内容は保持/);
    const stored = await withLocalTransaction(["notes"], "readonly", (tx) => readRequest<{ revision: number; strokesByPage: unknown }>(tx.objectStore("notes").get(f.note)));
    assert.equal(stored.revision, original.revision); assert.deepEqual(stored.strokesByPage, original.strokesByPage);
  } finally { unsubscribe(); }
});

test("版差分の本文確認中にローカル編集が進んでも、古い結果で確認版を進めない", async () => {
  const f = await fixture(); authorize(f); const original = await loadLocalNote(f.note);
  const sourceId = (await listDriveBindings())[0].ids!.note;
  f.files.set(sourceId, { ...f.files.get(sourceId)!, version: "2", sha256Checksum: undefined });
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
  const access = { ...f.access, download: async (...args: Parameters<typeof f.access.download>) => {
    const result = await f.access.download(...args); entered(); await gate; return result;
  } };
  const notices: string[] = []; const unsubscribe = subscribeDriveCacheIssue((_id, message) => notices.push(message));
  try {
    const verifying = checkQueuedDriveCaches(access, (await readLibraryState()).scope!, () => true); await started;
    await saveLocalNote({ file: f.file, noteId: f.note, expectedRevision: original.revision, strokesByPage: { 1: [{ width: 4, points: [{ x: .2, y: .3 }] }] } });
    release(); await verifying;
    const entity = (await readLibraryState()).entities.find((row) => row.entry.id === f.note)!;
    assert.equal(entity.cachedVersion, "1"); assert.equal(entity.cacheWarning, undefined); assert.deepEqual(notices, []);
    assert.equal((await loadLocalNote(f.note)).strokesByPage[1][0].width, 4);
  } finally { release(); unsubscribe(); }
});

test("版差分の本文確認中に接続先が変わった場合は確認版・警告・本文を変更しない", async () => {
  const f = await fixture(); authorize(f); await loadLocalNote(f.note);
  const sourceId = (await listDriveBindings())[0].ids!.note;
  f.files.set(sourceId, { ...f.files.get(sourceId)!, version: "2", sha256Checksum: undefined });
  let active = true;
  const access = { ...f.access, download: async (...args: Parameters<typeof f.access.download>) => {
    const result = await f.access.download(...args); active = false; return result;
  } };
  const before = await readLibraryState();
  await checkQueuedDriveCaches(access, before.scope!, () => active);
  assert.deepEqual(await readLibraryState(), before);
});

test("裏の更新確認で異なる版を見つけても本文・更新番号を変えず、次に開く時だけ新版を取得する", async () => {
  const f = await fixture(); const sourceId = (await listDriveBindings())[0].ids!.note;
  useDevice(); await enableDriveLibrary(connection.accountId, connection.rootId); await sync(f); authorize(f);
  const original = await loadLocalNote(f.note); await loadLocalNote(f.note);
  const changed = await remoteEdit(f, sourceId);
  const notices: string[] = []; const unsubscribe = subscribeDriveCacheIssue((id, message) => { assert.equal(id, f.note); notices.push(message); });
  try {
    await checkQueuedDriveCaches(f.access, (await readLibraryState()).scope!, () => true);
    assert.match(notices[0], /表示中の内容は保持/);
    const stored = await withLocalTransaction(["notes"], "readonly", (tx) => readRequest<{ revision: number; strokesByPage: unknown }>(tx.objectStore("notes").get(f.note)));
    assert.equal(stored.revision, original.revision); assert.deepEqual(stored.strokesByPage, original.strokesByPage);
    const refreshed = await loadLocalNote(f.note);
    assert.deepEqual(refreshed.strokesByPage, changed); assert.equal(refreshed.revision, original.revision! + 1);
    assert.equal((await listDriveBindings()).length, 0);
  } finally { unsubscribe(); }
});

test("自端末の保存先が外部変更されても、高速オープン後の編集で相手の内容を上書きしない", async () => {
  const f = await fixture(); authorize(f);
  const sourceId = (await listDriveBindings())[0].ids!.note;
  const original = await loadLocalNote(f.note); const changed = await remoteEdit(f, sourceId);
  await checkQueuedDriveCaches(f.access, (await readLibraryState()).scope!, () => true);
  await saveLocalNote({ file: original.file, noteId: f.note, expectedRevision: original.revision, strokesByPage: { 1: [{ width: 3, points: [{ x: .1, y: .1 }] }] } });
  await send(f);
  assert.match((await listDriveBindings())[0].error!, /競合/);
  assert.deepEqual(JSON.parse(await f.files.get(sourceId)!.data!.text()).strokesByPage, changed);
  assert.deepEqual((await loadLocalNote(f.note)).strokesByPage, { 1: [{ width: 3, points: [{ x: .1, y: .1 }] }] });
});

test("裏の確認中に編集・送信番号が進んだ場合、遅い応答で内容や警告を巻き戻さない", async () => {
  const f = await fixture(); authorize(f); const original = await loadLocalNote(f.note);
  const scope = (await readLibraryState()).scope!; const json = f.access.json.bind(f.access);
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
  const access = { ...f.access, json: async (...args: Parameters<typeof json>) => {
    const result = await json(...args); entered(); await gate;
    return { ...result as Record<string, unknown>, version: "changed" };
  } };
  const verifying = checkQueuedDriveCaches(access, scope, () => true); await started;
  await saveLocalNote({ file: original.file, noteId: f.note, expectedRevision: original.revision, strokesByPage: { 1: [{ width: 4, points: [{ x: .2, y: .3 }] }] } });
  release(); await verifying;
  assert.equal((await readLibraryState()).entities.find((row) => row.entry.id === f.note)!.cacheWarning, undefined);
  assert.equal((await loadLocalNote(f.note)).strokesByPage[1][0].width, 4);
});

test("裏の確認中に接続先が変わっても、元のノートへ確認結果を書き込まない", async () => {
  const f = await fixture(); authorize(f); await loadLocalNote(f.note);
  const scope = (await readLibraryState()).scope!; let active = true;
  const access = { ...f.access, json: async () => { active = false; return {}; } };
  const before = await readLibraryState(); await checkQueuedDriveCaches(access, scope, () => active);
  assert.deepEqual(await readLibraryState(), before);
});

test("直前のノートは1分後も保持し、30分経過後に未使用の同期済み本文だけ整理する", async () => {
  await fixture();
  const lock = async (_id: string, work: () => Promise<void>) => work();
  assert.equal(await pruneDriveCache({ now: Date.now()+60000, lock }), 0);
  assert.deepEqual(await bodyCount(), [1, 1]);
  assert.equal(await pruneDriveCache({ now: Date.now()+DRIVE_CACHE_RETENTION_MS+1000, lock }), 1);
  assert.deepEqual(await bodyCount(), [0, 0]);
});

test("変わっていない階層の定期確認では全ノート本文の読み書きを行わない", async () => {
  const f = await fixture(); const get = IDBObjectStore.prototype.get, put = IDBObjectStore.prototype.put; const touched: string[] = [];
  mock.method(IDBObjectStore.prototype, "get", function (this: IDBObjectStore, ...args: Parameters<typeof get>) {
    if (this.name === "notes") touched.push("get"); return get.apply(this, args);
  });
  mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
    if (this.name === "notes") touched.push("put"); return put.apply(this, args);
  });
  await sync(f); assert.deepEqual(touched, []);
});


test("長く開いたノートも閉じた時点から30分保持し、重複したピンを1つ外しても保護する", async () => {
  const f = await fixture(); let now = Date.now(); mock.method(Date, "now", () => now);
  const a = pinDriveNote(f.note), b = pinDriveNote(f.note);
  const lock = async (_id: string, work: () => Promise<void>) => work();
  now += DRIVE_CACHE_RETENTION_MS + 1000; a(); a();
  assert.equal(await pruneDriveCache({ now, lock }), 0);
  b(); await new Promise(setImmediate);
  assert.equal(await pruneDriveCache({ now: now + 60000, lock }), 0);
  assert.equal(await pruneDriveCache({ now: now + DRIVE_CACHE_RETENTION_MS + 1000, lock }), 1);
});

test("裏の確認が通信失敗しても本文を捨てず、キャッシュからの編集を続けられる", async () => {
  const f = await fixture(); authorize(f); const original = await loadLocalNote(f.note);
  const notices: string[] = []; const unsubscribe = subscribeDriveCacheIssue((_id, message) => { notices.push(message); });
  try {
    const access = { ...f.access, json: async () => { throw new DriveHttpError(0, "offline"); } };
    await checkQueuedDriveCaches(access, (await readLibraryState()).scope!, () => true);
    assert.match(notices[0], /端末の内容は保持/);
    assert.deepEqual((await loadLocalNote(f.note)).strokesByPage, original.strokesByPage);
    await saveLocalNote({ file: original.file, noteId: f.note, expectedRevision: original.revision, strokesByPage: {} });
    assert.ok((await listDriveBindings())[0].generation > (await listDriveBindings())[0].uploadedGeneration);
  } finally { unsubscribe(); }
});
