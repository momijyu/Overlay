import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";

import {
  createNoteFolder, deleteEmptyNoteFolder, deleteSavedNote, loadLocalNote, loadNoteLibrary,
  moveNoteFolder, moveSavedNote, organizeNote, renameNoteFolder, saveLocalNote,
} from "@/features/pdf-editor/localNotes";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
import type { PenStroke } from "@/features/pdf-editor/types";
import { createLocalAutosave } from "@/features/pdf-editor/localAutosave";
import { eraseStrokes } from "@/features/pdf-editor/eraseStrokes";

const file = new File(["%PDF-1.7\nlocal-test"], "授業.pdf", { type: "application/pdf" });
const strokes: Record<number, PenStroke[]> = {
  1: [{ points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }], width: 2.5 }],
  2: [{ points: [{ x: 0.3, y: 0.4 }], width: 5 }],
};

beforeEach(() => {
  // 各テスト専用のメモリ内IndexedDB。実ブラウザや利用者のデータには触れない。
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  mock.method(globalThis, "fetch", () => { throw new Error("ローカル保存で通信を行ってはいけません。"); });
});
afterEach(() => mock.restoreAll());

async function counts() {
  return withLocalTransaction(["notes", "pdfs", "folders"], "readonly", async (transaction) => Promise.all(
    ["notes", "pdfs", "folders"].map((name) => readRequest(transaction.objectStore(name).count())),
  ));
}

test("接続情報・認証・通信なしで空の一覧を開ける", async () => {
  assert.deepEqual(await loadNoteLibrary(), { notes: [], folders: [], foldersEnabled: true });
});

test("色付き線の部分消去・全消去を自動保存し、開き直しても切れ目と他ページを維持する", async () => {
  const red = { width: 2, color: "#ff0000", points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] };
  const blue = { ...red, color: "#0000ff" };
  const autosave = createLocalAutosave({ file, noteId: null, strokesByPage: {}, persist: saveLocalNote, onChange: () => {} });
  autosave.update({ 1: [red], 2: [blue] });
  await autosave.flush();
  const id = autosave.getState().noteId!;
  const loaded = await loadLocalNote(id);
  const center = { x: 0.5, y: 0.5 };
  const fragments = eraseStrokes(loaded.strokesByPage[1], center, center, 100, 100, 10, 1);
  autosave.update({ ...loaded.strokesByPage, 1: fragments });
  await autosave.flush();
  const restored = await loadLocalNote(id);
  assert.equal(restored.strokesByPage[1].length, 2);
  assert.ok(restored.strokesByPage[1].every((stroke) => stroke.color === "#ff0000" && stroke.width === 2));
  assert.deepEqual(restored.strokesByPage[2], [blue]);
  autosave.update({ ...restored.strokesByPage, 1: [] });
  await autosave.flush();
  assert.deepEqual((await loadLocalNote(id)).strokesByPage, { 1: [], 2: [blue] });
  assert.equal(await (await loadLocalNote(id)).file.text(), await file.text());
  assert.deepEqual(await counts(), [1, 1, 0]);
});

test("不正な色の保存を拒否し、前回の色・線を維持する", async () => {
  const red = { ...strokes[1][0], color: "#ff0000" };
  const id = await saveLocalNote({ file, strokesByPage: { 1: [red] }, noteId: null });
  await assert.rejects(saveLocalNote({ file, strokesByPage: { 1: [{ ...red, color: "#invalid" }] }, noteId: id }), /書き込み情報/);
  assert.deepEqual((await loadLocalNote(id)).strokesByPage, { 1: [red] });
});

test("保存後にDB接続を開き直しても、元PDFと複数ページの線が残る", async () => {
  const id = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  await withLocalTransaction(["notes"], "readonly", async (transaction) => { transaction.db.close(); });
  const library = await loadNoteLibrary();
  assert.equal(library.notes[0].id, id);
  assert.equal(library.notes[0].title, "授業");
  assert.equal(library.notes[0].folderId, null);
  assert.equal("strokesByPage" in library.notes[0], false);
  const loaded = await loadLocalNote(id);
  assert.equal(loaded.file.name, file.name);
  assert.equal(await loaded.file.text(), await file.text());
  assert.deepEqual(loaded.strokesByPage, strokes);
  assert.deepEqual(await counts(), [1, 1, 0]);
});

test("同じIDへ再保存しても元PDFを増やさず、名前・所属先を維持する", async () => {
  const id = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  const folder = await createNoteFolder("情報", null);
  await organizeNote(id, "第1回", folder);
  const updated = { ...strokes, 3: strokes[1] };
  const otherFile = new File(["different pdf"], "別.pdf");
  assert.equal(await saveLocalNote({ file: otherFile, strokesByPage: updated, noteId: id }), id);
  const note = (await loadNoteLibrary()).notes[0];
  assert.equal(note.title, "第1回");
  assert.equal(note.folderId, folder);
  assert.equal(await (await loadLocalNote(id)).file.text(), await file.text());
  assert.deepEqual((await loadLocalNote(id)).strokesByPage, updated);
  assert.deepEqual(await counts(), [1, 1, 1]);
});

test("異なるノートの線は混ざらず、取得したデータの編集も保存前には反映されない", async () => {
  const a = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  const b = await saveLocalNote({ file, strokesByPage: {}, noteId: null });
  const loaded = await loadLocalNote(a);
  loaded.strokesByPage[1][0].width = 99;
  assert.deepEqual((await loadLocalNote(b)).strokesByPage, {});
  assert.deepEqual((await loadLocalNote(a)).strokesByPage, strokes);
});

test("親子フォルダ・ノート移動・名前変更を保存し、子とPDF・線を維持する", async () => {
  const year = await createNoteFolder("2026", null);
  const subject = await createNoteFolder("情報", year);
  const destination = await createNoteFolder("2027", null);
  const id = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  await moveSavedNote(id, subject);
  await moveNoteFolder(year, destination);
  await renameNoteFolder(year, "  大学  ");
  let library = await loadNoteLibrary();
  assert.deepEqual(library.folders.find((folder) => folder.id === year), { id: year, name: "大学", parentId: destination });
  assert.equal(library.folders.find((folder) => folder.id === subject)?.parentId, year);
  assert.equal(library.notes[0].folderId, subject);
  assert.deepEqual((await loadLocalNote(id)).strokesByPage, strokes);
  await moveSavedNote(id, null);
  await moveNoteFolder(year, null);
  library = await loadNoteLibrary();
  assert.equal(library.notes[0].folderId, null);
  assert.equal(library.folders.find((folder) => folder.id === year)?.parentId, null);
});

test("作成・移動・名前変更時に同じ親の同名衝突を拒否する", async () => {
  const a = await createNoteFolder("Docs", null);
  const parent = await createNoteFolder("別", null);
  const b = await createNoteFolder("docs", parent);
  await assert.rejects(createNoteFolder(" DOCS ", null), /同じ名前/);
  await assert.rejects(moveNoteFolder(b, null), /移動できません/);
  await assert.rejects(renameNoteFolder(parent, "docs"), /同じ名前/);
  await assert.rejects(moveNoteFolder(a, parent), /移動できません/);
  assert.deepEqual(await counts(), [0, 0, 3]);
});

test("別接続から同時に同名フォルダを作っても、成功は1件だけ", async () => {
  const results = await Promise.allSettled([createNoteFolder("情報", null), createNoteFolder("情報", null)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await loadNoteLibrary()).folders.length, 1);
});

test("自己・子孫・現在の場所・不明な親へのフォルダ移動を拒否する", async () => {
  const root = await createNoteFolder("親", null);
  const child = await createNoteFolder("子", root);
  for (const parent of [root, child, null, "missing"]) {
    await assert.rejects(moveNoteFolder(root, parent), /移動できません/);
  }
  await assert.rejects(createNoteFolder("不明", "missing"), /フォルダが見つかりません/);
  assert.equal((await loadNoteLibrary()).folders.find((folder) => folder.id === root)?.parentId, null);
});

test("空フォルダだけ削除し、子フォルダ・ノートがある場合は拒否する", async () => {
  const root = await createNoteFolder("親", null);
  const child = await createNoteFolder("子", root);
  await assert.rejects(deleteEmptyNoteFolder(root), /空のフォルダだけ/);
  const id = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  await moveSavedNote(id, child);
  await assert.rejects(deleteEmptyNoteFolder(child), /空のフォルダだけ/);
  await moveSavedNote(id, null);
  await deleteEmptyNoteFolder(child);
  await deleteEmptyNoteFolder(root);
  await assert.rejects(deleteEmptyNoteFolder("missing"), /空のフォルダだけ/);
  assert.deepEqual(await counts(), [1, 1, 0]);
});

test("空白・長すぎる名前と不明なノート・フォルダは更新しない", async () => {
  for (const name of ["   ", "a".repeat(101)]) await assert.rejects(createNoteFolder(name, null), /名前は/);
  await assert.rejects(renameNoteFolder("missing", "新名"), /見つかりません/);
  await assert.rejects(organizeNote("missing", "題名", null), /見つかりません/);
  await assert.rejects(moveSavedNote("missing", null), /見つかりません/);
  const id = await saveLocalNote({ file, strokesByPage: {}, noteId: null });
  await assert.rejects(organizeNote(id, "a".repeat(121), null), /名前は/);
  await assert.rejects(moveSavedNote(id, "missing"), /見つかりません/);
});

test("不正な線と空のPDFを保存せず、不正な保存データも描画へ渡さない", async () => {
  const invalid = { 1: [{ width: -1, points: [{ x: 0, y: 0 }] }] };
  await assert.rejects(saveLocalNote({ file, strokesByPage: invalid, noteId: null }), /書き込み情報/);
  await assert.rejects(saveLocalNote({ file: new File([], "empty.pdf"), strokesByPage: {}, noteId: null }), /空のPDF/);
  assert.deepEqual(await counts(), [0, 0, 0]);
  const id = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  await withLocalTransaction(["notes"], "readwrite", async (transaction) => {
    const store = transaction.objectStore("notes");
    const note = await readRequest(store.get(id));
    await readRequest(store.put({ ...note, strokesByPage: invalid }));
  });
  await assert.rejects(loadLocalNote(id), /書き込み情報/);
});

test("既存ノートや元PDFが消えた場合に、新規ノートとして保存し直さない", async () => {
  await assert.rejects(loadLocalNote("missing"), /見つかりません/);
  await assert.rejects(saveLocalNote({ file, strokesByPage: strokes, noteId: "missing" }), /見つかりません/);
  assert.deepEqual(await counts(), [0, 0, 0]);
  const id = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  await withLocalTransaction(["pdfs"], "readwrite", async (transaction) => {
    await readRequest(transaction.objectStore("pdfs").delete(id));
  });
  await assert.rejects(saveLocalNote({ file, strokesByPage: {}, noteId: id }), /見つかりません/);
  assert.deepEqual(await counts(), [1, 0, 0]);
});

test("初回保存の途中で容量不足になってもPDFだけ残さず取り消す", async () => {
  const original = IDBObjectStore.prototype.add;
  mock.method(IDBObjectStore.prototype, "add", function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["add"]>) {
    if (this.name === "notes") throw new DOMException("full", "QuotaExceededError");
    return original.apply(this, args);
  });
  await assert.rejects(saveLocalNote({ file, strokesByPage: strokes, noteId: null }), /保存容量が不足/);
  assert.deepEqual(await counts(), [0, 0, 0]);
});

test("更新の失敗で、前回保存した線とPDFが失われない", async () => {
  const id = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  const original = IDBObjectStore.prototype.put;
  const failingPut = mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
    if (this.name === "notes") throw new DOMException("full", "QuotaExceededError");
    return original.apply(this, args);
  });
  await assert.rejects(saveLocalNote({ file, strokesByPage: {}, noteId: id }), /保存容量が不足/);
  failingPut.mock.restore();
  assert.deepEqual((await loadLocalNote(id)).strokesByPage, strokes);
  assert.deepEqual(await counts(), [1, 1, 0]);
});

test("トランザクションの中断を成功と扱わず、変更前の状態へ戻す", async () => {
  await assert.rejects(withLocalTransaction(["folders"], "readwrite", async (transaction) => {
    await readRequest(transaction.objectStore("folders").add({ id: "test", name: "仮", parentId: null }));
    transaction.abort();
  }));
  assert.deepEqual(await counts(), [0, 0, 0]);
});

test("IndexedDBを利用できない環境では空の一覧ではなくエラーを返す", async () => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  await assert.rejects(loadNoteLibrary(), /ブラウザ内保存を使用できません/);
});

test("自動保存から初回保存・描画・再取得までつながり、元PDFを重複保存しない", async () => {
  const autosave = createLocalAutosave({ file, noteId: null, strokesByPage: {}, persist: saveLocalNote, onChange: () => {} });
  await autosave.flush();
  assert.deepEqual(await counts(), [0, 0, 0]);
  autosave.update(strokes);
  await autosave.flush();
  const id = autosave.getState().noteId!;
  autosave.update({ ...strokes, 3: strokes[1] });
  await autosave.flush();
  assert.deepEqual((await loadLocalNote(id)).strokesByPage, { ...strokes, 3: strokes[1] });
  assert.equal((await loadLocalNote(id)).revision, 2);
  assert.deepEqual(await counts(), [1, 1, 0]);
});

test("ノートと元PDFを削除し、同じフォルダの他ノートと階層は維持する", async () => {
  const folder = await createNoteFolder("情報", null);
  const a = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  const b = await saveLocalNote({ file, strokesByPage: {}, noteId: null });
  await moveSavedNote(a, folder);
  await moveSavedNote(b, folder);
  await deleteSavedNote(a);
  assert.deepEqual(await counts(), [1, 1, 1]);
  assert.deepEqual((await loadLocalNote(b)).strokesByPage, {});
  assert.equal((await loadNoteLibrary()).notes[0].folderId, folder);
  await assert.rejects(loadLocalNote(a), /見つかりません/);
  await assert.rejects(deleteSavedNote(a), /削除するノートが見つかりません/);
});

test("PDF削除に失敗したら先行したノート削除も取り消す", async () => {
  const id = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  const original = IDBObjectStore.prototype.delete;
  const failure = mock.method(IDBObjectStore.prototype, "delete", function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["delete"]>) {
    if (this.name === "pdfs") throw new DOMException("unavailable", "UnknownError");
    return original.apply(this, args);
  });
  await assert.rejects(deleteSavedNote(id), /保存場所へアクセスできません/);
  failure.mock.restore();
  assert.deepEqual(await counts(), [1, 1, 0]);
  assert.deepEqual((await loadLocalNote(id)).strokesByPage, strokes);
});

test("元PDFが欠けたノートも削除して一覧から片付けられる", async () => {
  const id = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  await withLocalTransaction(["pdfs"], "readwrite", async (transaction) => {
    await readRequest(transaction.objectStore("pdfs").delete(id));
  });
  await deleteSavedNote(id);
  assert.deepEqual(await counts(), [0, 0, 0]);
});

test("削除後に別タブの自動保存が走ってもノートを復活させない", async () => {
  const id = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  const loaded = await loadLocalNote(id);
  const autosave = createLocalAutosave({ ...loaded, noteId: id, persist: saveLocalNote, onChange: () => {} });
  await deleteSavedNote(id);
  autosave.update({});
  assert.equal(await autosave.flush(), false);
  assert.match(autosave.getState().error!, /見つかりません/);
  assert.deepEqual(await counts(), [0, 0, 0]);
});

test("開始済みの保存を待って削除すれば、続く保存が対象を作り直さない", async () => {
  const id = await saveLocalNote({ file, strokesByPage: {}, noteId: null });
  const autosave = createLocalAutosave({ file, noteId: id, revision: 1, strokesByPage: {}, persist: saveLocalNote, onChange: () => {} });
  autosave.update(strokes);
  await autosave.flush();
  await deleteSavedNote(id);
  autosave.dispose();
  autosave.update({});
  await autosave.flush();
  assert.deepEqual(await counts(), [0, 0, 0]);
});

test("別タブの古い更新番号で上書きせず、先に保存した線を維持する", async () => {
  const id = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  const a = await loadLocalNote(id);
  const b = await loadLocalNote(id);
  await saveLocalNote({ file, strokesByPage: {}, noteId: id, expectedRevision: a.revision });
  await assert.rejects(saveLocalNote({ file, strokesByPage: strokes, noteId: id, expectedRevision: b.revision }), /別のタブ/);
  assert.deepEqual((await loadLocalNote(id)).strokesByPage, {});
  assert.deepEqual(await counts(), [1, 1, 0]);
});

test("更新番号のない既存ローカルノートを読み込み、更新後は番号を付ける", async () => {
  const id = await saveLocalNote({ file, strokesByPage: strokes, noteId: null });
  await withLocalTransaction(["notes"], "readwrite", async (transaction) => {
    const store = transaction.objectStore("notes");
    const note = await readRequest(store.get(id));
    delete note.revision;
    await readRequest(store.put(note));
  });
  const old = await loadLocalNote(id);
  assert.equal(old.revision, 0);
  await saveLocalNote({ file, strokesByPage: {}, noteId: id, expectedRevision: old.revision });
  assert.equal((await loadLocalNote(id)).revision, 1);
});
