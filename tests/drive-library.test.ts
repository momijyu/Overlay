import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { PDFDocument } from "pdf-lib";
import { createNoteFolder, deleteEmptyNoteFolder, deleteSavedNote, loadLocalNote, loadNoteLibrary, moveNoteFolder, moveSavedItems, moveSavedNote, organizeNote, renameNoteFolder, saveLocalNote } from "@/features/pdf-editor/localNotes";
import { enableDriveLibrary, readLibraryState } from "@/features/pdf-editor/driveLibraryLocal";
import { syncDriveLibrary } from "@/features/pdf-editor/driveLibraryRemote";
import { mergeLibraryEvents, type LibraryEvent } from "@/features/pdf-editor/driveLibraryData";
import { createDriveAutosave } from "@/features/pdf-editor/driveAutosave";
import { listDriveBindings } from "@/features/pdf-editor/driveOutbox";
import { sha256 } from "@/features/pdf-editor/driveAutosaveRemote";
import { DriveHttpError } from "@/features/pdf-editor/driveHttpError";
import { DRIVE_CACHE_LIMIT, DriveVersionRequired, pruneDriveCache } from "@/features/pdf-editor/driveLibraryCache";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
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
  const count = await pruneDriveCache({ now: Date.now() + 60000, lock: async (_id, work) => work() });
  assert.equal(count, 1); assert.deepEqual(await bodyCount(), [0, 0]);
  assert.equal((await loadNoteLibrary()).notes[0].id, f.note); assert.equal(f.files.size, remoteCount);
  await sync(f); assert.ok(!(await readLibraryState()).entities.some((r) => r.entry.deleted));
  authorize(f); assert.equal((await loadLocalNote(f.note)).id, f.note);
});

test("未送信・保存失敗・編集中のノートはキャッシュ整理で削除しない", async () => {
  const f = await fixture(); const locked = { now: Date.now() + 60000, lock: async (_id: string, work: () => Promise<void>) => work() };
  assert.equal(await pruneDriveCache({ ...locked, activeIds: new Set([f.note]) }), 0);
  await saveLocalNote({ file: f.file, noteId: f.note, expectedRevision: 1, strokesByPage: {} });
  assert.equal(await pruneDriveCache(locked), 0); assert.deepEqual(await bodyCount(), [1, 1]);
});

test("500MBを超える再取得可能キャッシュは猶予時間内でも整理する", async () => {
  const f = await fixture();
  await withLocalTransaction(["driveEntities"], "readwrite", async (tx) => {
    const store = tx.objectStore("driveEntities"); const row = await readRequest<Record<string, unknown>>(store.get(`note:${f.note}`));
    await readRequest(store.put({ ...row, cachedBytes: DRIVE_CACHE_LIMIT + 1, lastUsed: Date.now() }));
  }, false);
  assert.equal(await pruneDriveCache({ lock: async (_id, work) => work() }), 1);
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
  await assert.rejects(pruneDriveCache({ now: Date.now() + 60000, lock: async (_id, work) => work() }), /保存場所へアクセス/);
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
