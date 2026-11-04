import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { loadLocalNote, loadNoteLibrary, saveLocalNote, restoreNoteBackup, deleteSavedNote, organizeNote } from "@/features/pdf-editor/localNotes";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
import { prepareNoteDeduplication } from "@/features/pdf-editor/noteDuplicates";
import type { NoteBackup } from "@/features/pdf-editor/noteBackupData";

const file = new File(["%PDF-1.7\nsame-content"], "講義.pdf");
const strokesByPage = { 1: [{ width: 2, points: [{ x: 0.1, y: 0.2 }] }] };
function backup(): NoteBackup {
  return { schemaVersion: 1, kind: "note", name: "Driveの名前", folders: [], notes: [{
    id: "drive-key", title: "Driveの名前", fileName: "別の名前.pdf", folderId: null, pdf: file, strokesByPage, textsByPage: {},
  }] };
}
async function counts() {
  return withLocalTransaction(["notes", "pdfs", "noteSummaries"], "readonly", async (tx) => Promise.all(
    ["notes", "pdfs", "noteSummaries"].map((store) => readRequest(tx.objectStore(store).count()))));
}
const options = { skipDuplicates: true };
beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  mock.method(globalThis, "fetch", () => { throw new Error("重複比較では通信しない"); });
});
afterEach(() => mock.restoreAll());

test("Drive復元は名前・IDが違っても同じ元PDFと編集内容なら追加・上書きしない", async () => {
  const id = await saveLocalNote({ file, strokesByPage, noteId: null });
  await organizeNote(id, "ローカルで決めた名前", null);
  const before = await loadLocalNote(id);
  assert.deepEqual(await restoreNoteBackup(backup(), options), { notes: 0, folders: 0, skippedNotes: 1 });
  assert.deepEqual(await counts(), [1, 1, 1]);
  assert.equal((await loadNoteLibrary()).notes[0].title, "ローカルで決めた名前");
  const after = await loadLocalNote(id);
  assert.deepEqual({ ...after, file: null }, { ...before, file: null });
  assert.deepEqual(await after.file.arrayBuffer(), await before.file.arrayBuffer());
});

test("初回だけ復元し、再読み込み相当の別Blob・別IDでも二重に保存しない", async () => {
  assert.deepEqual(await restoreNoteBackup(backup(), options), { notes: 1, folders: 0, skippedNotes: 0 });
  const other = backup();
  other.notes[0] = { ...other.notes[0], id: "another-drive-key", pdf: new Blob([await file.arrayBuffer()]) };
  assert.equal((await restoreNoteBackup(other, options)).skippedNotes, 1);
  assert.deepEqual(await counts(), [1, 1, 1]);
});

test("同じPDFでも線・付箋が変われば別ノートとして残し、元の内容を維持する", async () => {
  await restoreNoteBackup(backup(), options);
  const changed = backup();
  changed.notes[0].strokesByPage = { 1: [{ ...strokesByPage[1][0], color: "#ff0000" }] };
  assert.equal((await restoreNoteBackup(changed, options)).notes, 1);
  const text = backup();
  text.notes[0].textsByPage = { 1: [{ id: "sticky", kind: "sticky", text: "復習", x: 0, y: 0, width: 0.5, fontSize: 16 }] };
  assert.equal((await restoreNoteBackup(text, options)).notes, 1);
  assert.deepEqual(await counts(), [3, 3, 3]);
});

test("名前・サイズ・編集が一致してもPDFバイトが違えば復元する", async () => {
  await restoreNoteBackup(backup(), options);
  const other = backup();
  other.notes[0].pdf = new Blob(["%PDF-1.7\nsame-contenX"]);
  assert.equal(other.notes[0].pdf.size, file.size);
  assert.equal((await restoreNoteBackup(other, options)).notes, 1);
  assert.deepEqual(await counts(), [2, 2, 2]);
});

test("旧ノートの文章なし・空ページの有無を差とせず、PDF欠落時は復元する", async () => {
  const id = await saveLocalNote({ file, strokesByPage: { ...strokesByPage, 2: [] }, noteId: null });
  await withLocalTransaction(["notes"], "readwrite", async (tx) => {
    const stored = await readRequest(tx.objectStore("notes").get(id));
    delete stored.textsByPage;
    await readRequest(tx.objectStore("notes").put(stored));
  });
  assert.equal((await restoreNoteBackup(backup(), options)).skippedNotes, 1);
  await withLocalTransaction(["pdfs"], "readwrite", async (tx) => { await readRequest(tx.objectStore("pdfs").delete(id)); });
  assert.equal((await restoreNoteBackup(backup(), options)).notes, 1);
});

test("削除後の再復元を妨げる履歴・キャッシュを残さない", async () => {
  await restoreNoteBackup(backup(), options);
  await deleteSavedNote((await loadNoteLibrary()).notes[0].id);
  assert.equal((await restoreNoteBackup(backup(), options)).notes, 1);
  assert.deepEqual(await counts(), [1, 1, 1]);
});

test("比較後の編集・削除・別タブの追加を再検証し、古い結果から重複・欠落を作らない", async () => {
  const id = await saveLocalNote({ file, strokesByPage, noteId: null });
  const check = await prepareNoteDeduplication(backup().notes[0]);
  await saveLocalNote({ file, strokesByPage: {}, noteId: id, expectedRevision: 1 });
  await assert.rejects(withLocalTransaction(["notes", "pdfs", "noteSummaries"], "readwrite", check), /比較中にノートが変更/);
  const absent = await prepareNoteDeduplication(backup().notes[0]);
  await restoreNoteBackup(backup());
  await assert.rejects(withLocalTransaction(["notes", "pdfs", "noteSummaries"], "readwrite", absent), /比較中にノートが変更/);
  const exists = await prepareNoteDeduplication(backup().notes[0]);
  const matching = (await loadNoteLibrary()).notes.find((note) => note.id !== id)!;
  await deleteSavedNote(matching.id);
  await assert.rejects(withLocalTransaction(["notes", "pdfs", "noteSummaries"], "readwrite", exists), /比較中にノートが変更/);
});

test("本文・PDFを全件一括取得せず、PDFは1MiBずつ比較し末尾の違いも検出する", async () => {
  const large = new File(["%PDF-", new Uint8Array(2 * 1024 * 1024)], "大.pdf");
  await saveLocalNote({ file: large, noteId: null, strokesByPage });
  const incoming = backup(); incoming.notes[0].pdf = large;
  const getAll = IDBObjectStore.prototype.getAll;
  mock.method(IDBObjectStore.prototype, "getAll", function (this: IDBObjectStore, ...args: Parameters<typeof getAll>) {
    assert.ok(this.name !== "notes" && this.name !== "pdfs");
    return getAll.apply(this, args);
  });
  const read = Blob.prototype.arrayBuffer;
  mock.method(Blob.prototype, "arrayBuffer", function (this: Blob) {
    assert.ok(this.size <= 1024 * 1024);
    return read.call(this);
  });
  assert.equal((await restoreNoteBackup(incoming, options)).skippedNotes, 1);
  incoming.notes[0].pdf = new Blob([large.slice(0, -1), new Uint8Array([1])]);
  assert.equal((await restoreNoteBackup(incoming, options)).notes, 1);
});

test("復元書き込み失敗はPDF・本文・一覧を全てロールバックし、再試行できる", async () => {
  const add = IDBObjectStore.prototype.add;
  const stub = mock.method(IDBObjectStore.prototype, "add", function (this: IDBObjectStore, ...args: Parameters<typeof add>) {
    if (this.name === "noteSummaries") throw new DOMException("容量不足", "QuotaExceededError");
    return add.apply(this, args);
  });
  await assert.rejects(restoreNoteBackup(backup(), options), /保存容量が不足/);
  stub.mock.restore();
  assert.deepEqual(await counts(), [0, 0, 0]);
  assert.equal((await restoreNoteBackup(backup(), options)).notes, 1);
});

test("従来のバックアップは明示したコピーを維持し、Drive単体以外への重複モード適用を拒否する", async () => {
  await restoreNoteBackup(backup()); await restoreNoteBackup(backup());
  assert.deepEqual(await counts(), [2, 2, 2]);
  const folder: NoteBackup = { schemaVersion: 1, kind: "folder", name: "空", notes: [], folders: [{ id: "root", name: "空", parentId: null }] };
  await assert.rejects(restoreNoteBackup(folder, options), /単独ノート/);
});
