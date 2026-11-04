import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import { IDBFactory, IDBObjectStore, IDBTransaction } from "fake-indexeddb";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
import { toLocalNoteSummary } from "@/features/pdf-editor/localNoteSummary";
import {
  captureNoteBackup, createNoteFolder, deleteSavedItems, deleteSavedNote, loadLocalNote, loadNoteLibrary,
  moveSavedItems, moveSavedNote, organizeNote, restoreNoteBackup, saveLocalNote,
} from "@/features/pdf-editor/localNotes";
import type { SavedNoteSummary } from "@/features/pdf-editor/types";

const file = new File(["%PDF-1.7\nsummary-test"], "講義.pdf", { type: "application/pdf" });
const strokesByPage = { 1: [{ width: 2, points: [{ x: 0.1, y: 0.2 }] }] };
const textsByPage = { 2: [{ id: "sticky", kind: "sticky" as const, text: "復習", x: 0.1, y: 0.2, width: 0.3, fontSize: 14 }] };
const stores = ["notes", "pdfs", "folders", "noteSummaries"] as const;

beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  mock.method(globalThis, "fetch", () => { throw new Error("一覧の軽量化で外部通信しない"); });
});
afterEach(() => mock.restoreAll());

async function snapshot() {
  return withLocalTransaction([...stores], "readonly", async (tx) => Promise.all(
    stores.map((name) => readRequest(tx.objectStore(name).getAll())),
  ));
}

async function assertSummariesMatch() {
  const [notes, , , summaries] = await snapshot();
  assert.deepEqual(summaries, notes.map(toLocalNoteSummary));
  assert.ok(summaries.every((note) => Object.keys(note).length === 5));
}

async function seedLegacy() {
  const opening = indexedDB.open("overlay-local-notes", 1);
  opening.onupgradeneeded = () => {
    for (const name of ["notes", "pdfs", "folders"]) opening.result.createObjectStore(name, { keyPath: "id" });
  };
  const db = await readRequest(opening);
  const tx = db.transaction(["notes", "pdfs", "folders"], "readwrite");
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  const first = { id: "legacy-a", title: "講義メモ", fileName: file.name, folderId: "folder", updatedAt: "2026-10-25T00:00:00Z",
    strokesByPage, textsByPage, revision: 7 };
  // 文章・更新番号のない旧データも移行時に書き換えない。
  const second = { id: "legacy-b", title: "旧ノート", fileName: "旧.pdf", folderId: null, updatedAt: "2026-10-24T00:00:00Z", strokesByPage: {} };
  for (const note of [first, second]) {
    tx.objectStore("notes").add(note);
    tx.objectStore("pdfs").add({ id: note.id, blob: file });
  }
  tx.objectStore("folders").add({ id: "folder", name: "情報", parentId: null });
  await done;
  db.close();
  return [first, second];
}

test("版1からは1件ずつ一覧情報を追加し、本文・元PDF・階層・更新番号を変更しない", async () => {
  const originals = await seedLegacy();
  const getAll = IDBObjectStore.prototype.getAll;
  const blocked = mock.method(IDBObjectStore.prototype, "getAll", function (this: IDBObjectStore, ...args: Parameters<typeof getAll>) {
    assert.ok(this.name !== "notes" && this.name !== "pdfs", "移行・一覧で全本文を一括取得しない");
    return getAll.apply(this, args);
  });
  const library = await loadNoteLibrary();
  assert.deepEqual(library.notes, originals.map(toLocalNoteSummary));
  blocked.mock.restore();
  const [notes, pdfs, folders, summaries] = await snapshot();
  assert.deepEqual(notes, originals);
  assert.deepEqual(summaries, originals.map(toLocalNoteSummary));
  assert.deepEqual(folders, [{ id: "folder", name: "情報", parentId: null }]);
  assert.equal(pdfs.length, 2);
  for (const pdf of pdfs) assert.equal(await pdf.blob.text(), await file.text());
  const loaded = await loadLocalNote("legacy-a");
  assert.equal(loaded.revision, 7);
  assert.deepEqual(loaded.strokesByPage, strokesByPage);
  assert.deepEqual(loaded.textsByPage, textsByPage);
  assert.deepEqual((await loadLocalNote("legacy-b")).textsByPage, {});
  assert.equal((await loadLocalNote("legacy-b")).revision, 0);
});

test("一覧の更新では本文・PDFストアをトランザクションに含めず読み取らない", async () => {
  const id = await saveLocalNote({ file, noteId: null, strokesByPage, textsByPage });
  const accesses: string[] = [];
  const objectStore = IDBTransaction.prototype.objectStore;
  const checked = mock.method(IDBTransaction.prototype, "objectStore", function (this: IDBTransaction, ...args: Parameters<typeof objectStore>) {
    accesses.push(args[0]);
    assert.ok(!this.objectStoreNames.contains("notes") && !this.objectStoreNames.contains("pdfs"));
    return objectStore.apply(this, args);
  });
  const library = await loadNoteLibrary();
  checked.mock.restore();
  assert.equal(library.notes[0].id, id);
  assert.deepEqual(accesses.sort(), ["folders", "noteSummaries"]);
});

test("新規保存・再保存・名前変更・単独／一括移動は本文と一覧を同時に更新する", async () => {
  const first = await saveLocalNote({ file, noteId: null, strokesByPage, textsByPage });
  const second = await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  await assertSummariesMatch();
  const parent = await createNoteFolder("講義", null);
  await organizeNote(first, "復習ノート", parent);
  await assertSummariesMatch();
  await saveLocalNote({ file, noteId: first, strokesByPage: {}, expectedRevision: 1 });
  await assertSummariesMatch();
  await moveSavedNote(first, null);
  await assertSummariesMatch();
  await moveSavedItems([{ kind: "note", id: first }, { kind: "note", id: second }], parent);
  await assertSummariesMatch();
  assert.equal((await loadLocalNote(first)).revision, 2);
  assert.deepEqual((await loadLocalNote(first)).textsByPage, textsByPage);
  await deleteSavedNote(first);
  await assertSummariesMatch();
  await deleteSavedItems([{ kind: "note", id: second }]);
  await assertSummariesMatch();
  assert.equal((await loadNoteLibrary()).notes.length, 0);
});

test("一覧情報の初回保存が失敗しても、元PDF・本文だけを残さない", async () => {
  await loadNoteLibrary();
  const add = IDBObjectStore.prototype.add;
  mock.method(IDBObjectStore.prototype, "add", function (this: IDBObjectStore, ...args: Parameters<typeof add>) {
    if (this.name === "noteSummaries") throw new DOMException("full", "QuotaExceededError");
    return add.apply(this, args);
  });
  await assert.rejects(saveLocalNote({ file, noteId: null, strokesByPage }), /保存容量が不足/);
  assert.deepEqual(await snapshot(), [[], [], [], []]);
});

test("一覧更新の失敗では編集更新・名前変更・移動と更新番号をまとめて取り消す", async () => {
  const first = await saveLocalNote({ file, noteId: null, strokesByPage, textsByPage });
  const second = await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  const folder = await createNoteFolder("移動先", null);
  const before = await snapshot();
  const put = IDBObjectStore.prototype.put;
  const failure = mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
    if (this.name === "noteSummaries") throw new DOMException("full", "QuotaExceededError");
    return put.apply(this, args);
  });
  for (const operation of [
    () => saveLocalNote({ file, noteId: first, strokesByPage: {}, expectedRevision: 1 }),
    () => organizeNote(first, "変更後", folder),
    () => moveSavedNote(first, folder),
    () => moveSavedItems([{ kind: "note", id: first }, { kind: "note", id: second }], folder),
  ]) {
    await assert.rejects(operation(), /保存容量が不足/);
    assert.deepEqual(await snapshot(), before);
  }
  failure.mock.restore();
  await assertSummariesMatch();
});

test("一覧情報の削除失敗では単独・一括ともPDF・本文・階層を削除しない", async () => {
  const id = await saveLocalNote({ file, noteId: null, strokesByPage });
  const folder = await createNoteFolder("親", null);
  await moveSavedNote(id, folder);
  const before = await snapshot();
  const remove = IDBObjectStore.prototype.delete;
  mock.method(IDBObjectStore.prototype, "delete", function (this: IDBObjectStore, ...args: Parameters<typeof remove>) {
    if (this.name === "noteSummaries") throw new Error("一覧削除失敗");
    return remove.apply(this, args);
  });
  await assert.rejects(deleteSavedNote(id), /一覧削除失敗/);
  assert.deepEqual(await snapshot(), before);
  await assert.rejects(deleteSavedItems([{ kind: "folder", id: folder }, { kind: "note", id }]), /一覧削除失敗/);
  assert.deepEqual(await snapshot(), before);
});

test("バックアップ復元でも一覧を追加し、一覧の追加失敗では全件を残さない", async () => {
  const id = await saveLocalNote({ file, noteId: null, strokesByPage, textsByPage });
  const backup = await captureNoteBackup({ kind: "note", id });
  await restoreNoteBackup(backup);
  await assertSummariesMatch();
  const before = await snapshot();
  const add = IDBObjectStore.prototype.add;
  mock.method(IDBObjectStore.prototype, "add", function (this: IDBObjectStore, ...args: Parameters<typeof add>) {
    if (this.name === "noteSummaries") throw new DOMException("full", "QuotaExceededError");
    return add.apply(this, args);
  });
  await assert.rejects(restoreNoteBackup(backup), /保存容量が不足/);
  assert.deepEqual(await snapshot(), before);
});

test("移行途中の容量不足は版1へ戻し、再試行で全件を移行できる", async () => {
  const originals = await seedLegacy();
  const add = IDBObjectStore.prototype.add;
  let writes = 0;
  const failure = mock.method(IDBObjectStore.prototype, "add", function (this: IDBObjectStore, ...args: Parameters<typeof add>) {
    if (this.name === "noteSummaries" && ++writes === 2) throw new DOMException("full", "QuotaExceededError");
    return add.apply(this, args);
  });
  await assert.rejects(loadNoteLibrary(), /保存容量が不足/);
  failure.mock.restore();
  const legacy = await readRequest(indexedDB.open("overlay-local-notes", 1));
  assert.equal(legacy.version, 1);
  assert.equal(legacy.objectStoreNames.contains("noteSummaries"), false);
  const transaction = legacy.transaction("notes", "readonly");
  assert.deepEqual(await readRequest(transaction.objectStore("notes").getAll()), originals);
  legacy.close();
  assert.deepEqual((await loadNoteLibrary()).notes, originals.map(toLocalNoteSummary));
  await assertSummariesMatch();
});

test("同時に一覧を開いても移行は一度だけ、本文・一覧・PDFが重複しない", async () => {
  const originals = await seedLegacy();
  const opening = mock.method(indexedDB, "open");
  const lists = await Promise.all([loadNoteLibrary(), loadNoteLibrary(), loadNoteLibrary()]);
  assert.equal(opening.mock.callCount(), 1);
  assert.ok(lists.every((library) => library.notes.length === originals.length));
  const [notes, pdfs, , summaries] = await snapshot();
  assert.equal(notes.length, 2);
  assert.equal(pdfs.length, 2);
  assert.equal(summaries.length, 2);
});

test("一覧用データは余分な編集情報を持ち込まず、元のオブジェクトを変更しない", () => {
  const record = { id: "test", title: "題名", fileName: "test.pdf", folderId: null, updatedAt: "date", strokesByPage, textsByPage };
  const summary: SavedNoteSummary = toLocalNoteSummary(record);
  assert.deepEqual(summary, { id: "test", title: "題名", fileName: "test.pdf", folderId: null, updatedAt: "date" });
  assert.equal(record.strokesByPage, strokesByPage);
  assert.equal(record.textsByPage, textsByPage);
});
