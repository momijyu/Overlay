import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { createDriveAutosave } from "@/features/pdf-editor/driveAutosave";
import { captureDriveJob, driveJobDue, enableDriveAutosave, listDriveBindings, updateDriveBinding } from "@/features/pdf-editor/driveOutbox";
import { DriveHttpError } from "@/features/pdf-editor/driveHttpError";
import { deleteSavedNote, loadLocalNote, organizeNote, saveLocalNote } from "@/features/pdf-editor/localNotes";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
import { loadDriveNote, listDriveNotes, overwriteDriveNote, type DriveNoteAccess } from "@/features/pdf-editor/googleDriveNotes";
import { sha256 } from "@/features/pdf-editor/driveAutosaveRemote";
import { driveAutosaveStatus } from "@/features/pdf-editor/components/DriveAutosavePanel";
import { DriveAutosavePanel } from "@/features/pdf-editor/components/DriveAutosavePanel";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const file = new File(["%PDF-1.7\nfixture"], "授業.pdf", { type: "application/pdf" });
const connection = { accountId: "account_A", rootId: "root_A" };
const strokes = { 1: [{ width: 2, points: [{ x: 0.1, y: 0.2 }] }] };
beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  mock.method(globalThis, "fetch", () => { throw new Error("実Googleへ接続しない"); });
});
afterEach(() => mock.restoreAll());

function remote() {
  type Item = { id: string; name: string; appProperties: Record<string, string>; data?: Blob; [key: string]: unknown };
  const files = new Map<string, Item>();
  const calls: string[] = [];
  let serial = 0;
  let unknownResult = "";
  let beforeReplace: (() => Promise<void>) | null = null;
  const save = async (details: Record<string, unknown>, data?: Blob) => {
    const id = String(details.id);
    if (files.has(id)) throw new DriveHttpError(409, "exists");
    const item: Item = { ...details, id, name: String(details.name), appProperties: details.appProperties as Record<string, string>,
      ownedByMe: true, trashed: false, modifiedTime: "2026-11-05T00:00:00Z", version: "1",
      ...(data ? { data, size: String(data.size), sha256Checksum: await sha256(data) } : {}) };
    files.set(id, item);
    if (unknownResult === item.appProperties.overlayRole) { unknownResult = ""; throw new DriveHttpError(0, "通信断"); }
    return item;
  };
  const access: DriveNoteAccess = {
    async json(path, parameters, body) {
      calls.push(`${body ? "POST" : "GET"} ${path}`);
      if (path === "files/generateIds") return { ids: [`folder_${++serial}`, `pdf_${++serial}`, `json_${++serial}`] };
      if (path === "files" && body) return save(body as Record<string, unknown>);
      if (path === "files") return { files: [...files.values()].filter((item) => item.appProperties.overlayRole === "sync-note") };
      const item = files.get(path.split("/")[1]);
      if (!item) throw new DriveHttpError(404, "not found");
      return item;
    },
    async upload(details, data) { calls.push(`upload ${details.mimeType}`); return save(details, data); },
    async download(id) { calls.push(`download ${id}`); return files.get(id)!.data!; },
    async replace(id, data, details) {
      calls.push(`replace ${id}`);
      await beforeReplace?.();
      const previous = files.get(id)!;
      files.set(id, { ...previous, ...details, data, size: String(data.size) });
      if (unknownResult === "replace") { unknownResult = ""; throw new DriveHttpError(0, "通信断"); }
      return files.get(id)!;
    },
  };
  return { access, files, calls, failAfterSave(role: string) { unknownResult = role; }, onReplace(work: () => Promise<void>) { beforeReplace = work; } };
}
async function setup() {
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: strokes });
  await enableDriveAutosave(id, connection.accountId, connection.rootId);
  const f = remote();
  let current: typeof connection | null = connection;
  let time = Date.now() + 20000;
  const runner = createDriveAutosave({ connection: () => current, access: async () => f.access, now: () => time,
    lock: async (_name, work) => work() });
  return { ...f, id, runner, advance() { time += 120000; }, reconnect(value: typeof current) { current = value; } };
}
async function row() { return (await listDriveBindings())[0]; }

test("有効化は選んだノートだけ。本文・PDFを複製せず端末IDと送信待ちを永続化する", async () => {
  const f = await setup();
  const second = await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  assert.equal((await listDriveBindings()).length, 1);
  const first = await row();
  assert.equal(first.generation, 1); assert.equal(first.uploadedGeneration, 0);
  assert.ok(!JSON.stringify(first).includes("strokesByPage"));
  await enableDriveAutosave(second, connection.accountId, connection.rootId);
  assert.equal((await listDriveBindings())[1].deviceId, first.deviceId);
  await enableDriveAutosave(f.id, connection.accountId, connection.rootId);
  assert.equal((await listDriveBindings()).length, 2);
  assert.equal((await listDriveBindings()).find((r) => r.id === f.id)?.key, first.key);
  await assert.rejects(enableDriveAutosave(f.id, "account_B", connection.rootId), /連携したGoogleアカウント/);
});

test("編集・名前変更と送信番号は同時commit。送信待ちの書込失敗では本文も戻す", async () => {
  const f = await setup();
  await saveLocalNote({ file, noteId: f.id, expectedRevision: 1, strokesByPage: {} });
  await organizeNote(f.id, "変更", null);
  assert.equal((await row()).generation, 3);
  const put = IDBObjectStore.prototype.put;
  mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
    if (this.name === "driveBindings") throw new DOMException("full", "QuotaExceededError");
    return put.apply(this, args);
  });
  await assert.rejects(saveLocalNote({ file, noteId: f.id, expectedRevision: 2, strokesByPage: strokes }), /容量が不足/);
  assert.equal((await row()).generation, 3);
  assert.deepEqual((await loadLocalNote(f.id)).strokesByPage, {});
});

test("短い連続編集は2秒待ち、連続入力中でも10秒で送信対象になる", () => {
  const binding = { id: "n", key: "k", deviceId: "d", ...connection, enabled: true, generation: 2, uploadedGeneration: 1, dirtySince: 1000, changedAt: 10000 };
  assert.equal(driveJobDue(binding, 10999), false);
  assert.equal(driveJobDue(binding, 11000), true);
  assert.equal(driveJobDue({ ...binding, changedAt: 1000 }, 3000), true);
  assert.equal(driveJobDue({ ...binding, uploadedGeneration: 2 }, 20000), false);
});

test("初回だけ元PDFを送り、再編集・改名・付箋・白紙・見出しは同じJSONへ保存する", async () => {
  const f = await setup();
  await f.runner.tick();
  const before = await row();
  assert.equal(before.uploadedGeneration, 1);
  await organizeNote(f.id, "期末", null);
  await saveLocalNote({ file, noteId: f.id, expectedRevision: 1, strokesByPage: {}, textsByPage: {
    2: [{ id: "s", kind: "sticky", text: "見直す", x: 0.1, y: 0.2, width: 0.3, fontSize: 14 }],
  }, pages: [{ id: 1, kind: "pdf", pageNumber: 1 }, { id: 2, kind: "blank", width: 600, height: 800 }], headingsByPage: { 2: "計算" } });
  f.advance(); await f.runner.tick();
  const after = await row();
  assert.deepEqual(after.ids, before.ids); assert.equal(after.uploadedGeneration, after.generation);
  assert.equal(f.calls.filter((c) => c === "upload application/pdf").length, 1);
  assert.equal(f.files.size, 3);
  const json = JSON.parse(await f.files.get(after.ids!.note)!.data!.text());
  assert.equal(json.schemaVersion, 4); assert.equal(json.title, "期末"); assert.equal(json.headingsByPage[2], "計算");
  assert.equal(json.textsByPage[2][0].text, "見直す"); assert.equal(json.pages[1].kind, "blank");
  assert.equal(f.files.get(after.ids!.note)!.name, "期末.overlay.json");
});

for (const failedRole of ["note-container", "pdf", "sync-note", "replace"]) {
  test(`保存成功直後に応答を失っても固定IDで再開し、重複を作らない (${failedRole})`, async () => {
    const f = await setup();
    if (failedRole === "replace") {
      await f.runner.tick();
      await saveLocalNote({ file, noteId: f.id, expectedRevision: 1, strokesByPage: {} });
      f.advance();
    }
    f.failAfterSave(failedRole); await f.runner.tick();
    const pending = await row();
    assert.ok(pending.generation > pending.uploadedGeneration);
    assert.ok(pending.retryAt); assert.equal(pending.error, undefined);
    f.advance(); await f.runner.tick();
    assert.equal(f.files.size, 3);
    assert.equal((await row()).uploadedGeneration, (await row()).generation);
    assert.equal(f.calls.filter((c) => c === "GET files/generateIds").length, 1);
  });
}

test("送信中の追記は未送信のまま残り、次回送信する", async () => {
  const f = await setup(); await f.runner.tick();
  await saveLocalNote({ file, noteId: f.id, expectedRevision: 1, strokesByPage: {} }); f.advance();
  let changed = false;
  f.onReplace(async () => { if (!changed) { changed = true; await organizeNote(f.id, "追記", null); } });
  await f.runner.tick();
  assert.equal((await row()).generation, 3); assert.equal((await row()).uploadedGeneration, 2);
  f.advance(); await f.runner.tick();
  assert.equal((await row()).uploadedGeneration, 3);
});

test("再接続待ち・別アカウント・一時停止中は送らず、再開後に最新を送る", async () => {
  const f = await setup(); f.reconnect(null); await f.runner.tick(); assert.equal(f.calls.length, 0);
  f.reconnect({ ...connection, accountId: "account_B" }); await f.runner.tick(); assert.equal(f.calls.length, 0);
  f.reconnect(connection);
  await updateDriveBinding(f.id, (await row()).key, (r) => ({ ...r, enabled: false }));
  await f.runner.tick(); assert.equal(f.calls.length, 0);
  await enableDriveAutosave(f.id, connection.accountId, connection.rootId);
  await f.runner.tick(); assert.equal((await row()).uploadedGeneration, 1);
});

test("再読み込みで作り直した送信係も待ち情報を再利用する", async () => {
  const f = await setup(); f.failAfterSave("pdf"); await f.runner.tick(); f.runner.dispose();
  const ids = (await row()).ids;
  const next = createDriveAutosave({ connection: () => connection, access: async () => f.access,
    now: () => Date.now() + 200000, lock: async (_name, work) => work() });
  await next.tick();
  assert.deepEqual((await row()).ids, ids); assert.equal(f.files.size, 3);
});

test("ロックを取れない別タブは何も送らず、送信中のtickも重複しない", async () => {
  const f = await setup();
  const skip = createDriveAutosave({ connection: () => connection, access: async () => f.access,
    now: () => Date.now() + 200000, lock: async () => {} });
  await skip.tick(); assert.equal(f.calls.length, 0);
  await Promise.all([f.runner.tick(), f.runner.tick()]);
  assert.equal(f.calls.filter((c) => c === "GET files/generateIds").length, 1);
});

test("削除でPDF・本文・待ち情報を同時に消し、古い送信完了で復活させない", async () => {
  const f = await setup(); await f.runner.tick();
  const old = await row();
  await deleteSavedNote(f.id);
  assert.equal(await updateDriveBinding(f.id, old.key, (r) => ({ ...r, uploadedGeneration: 999 })), null);
  assert.equal(await captureDriveJob(f.id, old.key), null);
  assert.deepEqual(await listDriveBindings(), []);
  assert.equal(await withLocalTransaction(["pdfs"], "readonly", (tx) => readRequest(tx.objectStore("pdfs").count())), 0);
  assert.equal(f.files.size, 3, "ローカルの削除でDriveを勝手に削除しない");
});

test("別端末の自動保存は別ファイルになり、一覧・復元から両方を選べる", async () => {
  const f = await setup(); await f.runner.tick();
  const previous = await row();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  await enableDriveAutosave(id, connection.accountId, connection.rootId);
  const other = createDriveAutosave({ connection: () => connection, access: async () => f.access,
    now: () => Date.now() + 200000, lock: async (_name, work) => work() });
  await other.tick();
  assert.notEqual((await row()).deviceId, previous.deviceId);
  assert.equal(f.files.size, 6);
  const notes = (await listDriveNotes(f.access, connection.rootId)).notes;
  assert.equal(notes.length, 2);
  assert.deepEqual((await loadDriveNote(f.access, connection.rootId, previous.ids!.note)).notes[0].strokesByPage, strokes);
  const source = notes[0];
  const snapshot = (await captureDriveJob(id, (await row()).key)); assert.equal(snapshot, null);
  const backup = await loadDriveNote(f.access, connection.rootId, source.id);
  await assert.rejects(overwriteDriveNote(f.access, connection.rootId, backup, { note: source, version: "1" }), /手動で上書きできません/);
});

test("外部変更・同じ世代の内容改変は停止し、端末の最新編集を消さない", async () => {
  const f = await setup(); await f.runner.tick();
  const binding = await row();
  const stored = f.files.get(binding.ids!.note)!;
  const json = JSON.parse(await stored.data!.text());
  json.title = "外部改変";
  const content = { ...json }; delete content.schemaVersion; delete content.sync;
  json.sync.hash = await sha256(new Blob([JSON.stringify(content)]));
  stored.data = new Blob([JSON.stringify(json)]); stored.size = String(stored.data.size);
  await saveLocalNote({ file, noteId: f.id, expectedRevision: 1, strokesByPage: {} }); f.advance(); await f.runner.tick();
  assert.match((await row()).error!, /競合/);
  assert.equal((await row()).uploadedGeneration, 1);
  assert.deepEqual((await loadLocalNote(f.id)).strokesByPage, {});
});

test("未送信・再接続・失敗だけを案内し、保存済みの常設通知は出さない", async () => {
  const f = await setup();
  assert.match(driveAutosaveStatus(await listDriveBindings(), null), /再接続/);
  const ready = { account: { id: connection.accountId }, root: { id: connection.rootId } };
  assert.match(driveAutosaveStatus(await listDriveBindings(), ready), /保存待ち/);
  await f.runner.tick();
  assert.equal(driveAutosaveStatus(await listDriveBindings(), ready), "");
});

test("再試行の404→作成409でも既存の予約IDを検証し、別IDを作らない", async () => {
  const f = await setup(); f.failAfterSave("pdf"); await f.runner.tick();
  const saved = await row();
  const original = f.access.json;
  let hidden = false;
  f.access.json = async (path, ...args) => {
    if (!hidden && path === `files/${saved.ids!.pdf}`) { hidden = true; throw new DriveHttpError(404, "not found"); }
    return original(path, ...args);
  };
  f.advance(); await f.runner.tick();
  assert.equal(f.files.size, 3);
  assert.deepEqual((await row()).ids, saved.ids);
  assert.equal((await row()).generation, (await row()).uploadedGeneration);
});

test("認証失効は再接続待ち。再認証後も同じ送信待ちを使う", async () => {
  const f = await setup();
  const original = f.access.json;
  let expired = false;
  f.access.json = async (...args) => {
    if (!expired) { expired = true; f.reconnect(null); throw new Error("認証期限切れ"); }
    return original(...args);
  };
  await f.runner.tick();
  assert.equal((await row()).uploadedGeneration, 0);
  assert.equal((await row()).error, undefined);
  f.reconnect(connection); await f.runner.tick();
  assert.equal((await row()).uploadedGeneration, 1);
});

test("恒久エラーは自動連打せず停止し、再試行の明示操作まで内容を残す", async () => {
  const f = await setup();
  const original = f.access.json;
  f.access.json = async () => { throw new DriveHttpError(403, "アクセス権を確認してください"); };
  await f.runner.tick();
  assert.match((await row()).error!, /アクセス権/);
  f.access.json = original; f.advance(); await f.runner.tick();
  assert.equal(f.files.size, 0);
  await enableDriveAutosave(f.id, connection.accountId, connection.rootId);
  await f.runner.tick(); assert.equal((await row()).uploadedGeneration, 1);
});

test("初回準備中に一時停止・削除されたノートを後から送信しない", async () => {
  const f = await setup();
  const original = f.access.json;
  f.access.json = async (path, ...args) => {
    const result = await original(path, ...args);
    if (path === "files/generateIds") await deleteSavedNote(f.id);
    return result;
  };
  await f.runner.tick();
  assert.deepEqual(await listDriveBindings(), []); assert.equal(f.files.size, 0);
});

test("DB版5→6は既存PDF・編集・付箋参照を保持し、既存ノートを勝手に送信登録しない", async () => {
  const request = indexedDB.open("overlay-local-notes", 5);
  request.onupgradeneeded = () => { for (const name of ["notes", "pdfs", "folders", "noteSummaries"]) request.result.createObjectStore(name, { keyPath: "id" }); };
  const db = await readRequest(request);
  const tx = db.transaction(["notes", "pdfs", "noteSummaries"], "readwrite");
  const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  const note = { id: "old", title: "授業", fileName: file.name, folderId: null, updatedAt: "2026-11-04T00:00:00Z", strokesByPage: strokes, revision: 7 };
  tx.objectStore("notes").add(note); tx.objectStore("pdfs").add({ id: "old", blob: file });
  tx.objectStore("noteSummaries").add({ id: "old", title: "授業", fileName: file.name, folderId: null, updatedAt: note.updatedAt });
  await done; db.close();
  assert.deepEqual(await listDriveBindings(), []);
  const loaded = await loadLocalNote("old");
  assert.equal(loaded.revision, 7); assert.equal(await loaded.file.text(), await file.text());
  assert.deepEqual(loaded.strokesByPage, strokes);
  assert.deepEqual(await withLocalTransaction(["notes"], "readonly", (t) => readRequest(t.objectStore("notes").get("old"))), note);
});

test("未選択の画面ではGoogle認証・送信を開始せず、保存済みノートの選択を案内する", () => {
  const html = renderToStaticMarkup(createElement(DriveAutosavePanel, { noteId: null, title: "", disabled: false, drawerOpen: true }));
  assert.match(html, /保存済みのノートを開いてください/);
  assert.ok(!html.includes("このノートで有効にする"));
  assert.ok(!html.includes("Driveに保存済み"));
});
