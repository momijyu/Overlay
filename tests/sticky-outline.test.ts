import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { PDFDocument } from "pdf-lib";
import { createStickyOutline, stickyOutlineGroups, stickyDestination } from "@/features/pdf-editor/stickyOutline";
import { saveLocalNote, loadLocalNote, loadNoteLibrary, organizeNote, deleteSavedNote, captureNoteBackup, restoreNoteBackup } from "@/features/pdf-editor/localNotes";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
import { encodeNoteBackup, decodeNoteBackup } from "@/features/pdf-editor/noteBackupFile";
import { insertBlankPage, resolveNotePages } from "@/features/pdf-editor/notePages";
import type { SavedNoteSummary, TextNotesByPage } from "@/features/pdf-editor/types";

const pdf = await PDFDocument.create(); pdf.addPage([600, 800]); pdf.addPage([600, 800]);
const file = new File([new Uint8Array(await pdf.save())], "講義.pdf", { type: "application/pdf" });
const sticky = { id: "sticky", kind: "sticky" as const, text: "試験範囲\n大事な計算", x: .1, y: .2, width: .3, fontSize: 14 };
const texts: TextNotesByPage = { 2: [sticky, { ...sticky, id: "plain", kind: "text" }, { ...sticky, id: "other", text: "質問" }] };
const pages = insertBlankPage(resolveNotePages(undefined, 2), 1, 600, 800);
beforeEach(() => Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() }));
afterEach(() => mock.restoreAll());

test("すべての付箋だけを表示順へ並べ、先頭行とページ・付箋IDだけを抽出する", () => {
  const entries = createStickyOutline({ ...texts, 3: [{ ...sticky, id: "blank", text: "\n 計算メモ \n続き" }] }, pages);
  assert.deepEqual(entries, [
    { pageId: 3, pageNumber: 2, textId: "blank", label: "計算メモ" },
    { pageId: 2, pageNumber: 3, textId: "sticky", label: "試験範囲" },
    { pageId: 2, pageNumber: 3, textId: "other", label: "質問" },
  ]);
  assert.equal(createStickyOutline({ 1: [{ ...sticky, text: "長".repeat(2000) }] })[0].label.length, 120);
  assert.deepEqual(createStickyOutline(undefined), []);
  assert.deepEqual(createStickyOutline({ 9: [sticky] }, pages), []);
  assert.equal(sticky.text, "試験範囲\n大事な計算");
});

test("ページ挿入・付箋の移動後もIDでページを解決し、削除済み・同IDのテキストは拒否する", () => {
  assert.equal(stickyDestination(pages, texts, 2, "sticky"), 3);
  assert.equal(stickyDestination(pages, { 2: [{ ...sticky, x: .5, y: .5 }] }, 2, "sticky"), 3);
  assert.throws(() => stickyDestination(pages, {}, 2, "sticky"), /削除または変更/);
  assert.throws(() => stickyDestination(pages, texts, 2, "plain"), /削除または変更/);
  assert.throws(() => stickyDestination(pages, texts, 9, "sticky"), /削除または変更/);
});

test("開いている資料は未保存の最新付箋で置き換え、削除後に古い一覧を再表示しない", () => {
  const notes: SavedNoteSummary[] = ["a", "b"].map((id) => ({ id, title: id, fileName: "a.pdf", folderId: null, updatedAt: "date",
    stickyNotes: createStickyOutline(texts) }));
  const current = { id: "a", title: "編集中", entries: createStickyOutline({ 1: [{ ...sticky, text: "最新" }] }) };
  const groups = stickyOutlineGroups(notes, current);
  assert.deepEqual(groups.map((group) => group.title), ["編集中", "b"]);
  assert.equal(groups[0].entries[0].label, "最新");
  assert.deepEqual(stickyOutlineGroups(notes, { ...current, entries: [] }).map((group) => group.title), ["b"]);
  assert.equal(stickyOutlineGroups(notes, { ...current, id: null })[0].note, null);
});

test("保存・名前変更・文章変更・削除と参照一覧を同時更新し、本文・PDFを一覧で読まない", async () => {
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: {}, textsByPage: texts, pages });
  await organizeNote(id, "新しい資料名", null);
  const getter = IDBObjectStore.prototype.getAll;
  const guarded = mock.method(IDBObjectStore.prototype, "getAll", function (this: IDBObjectStore, ...args: Parameters<typeof getter>) {
    assert.ok(this.name !== "notes" && this.name !== "pdfs"); return getter.apply(this, args);
  });
  const summary = (await loadNoteLibrary()).notes[0]; guarded.mock.restore();
  assert.equal(summary.title, "新しい資料名");
  assert.deepEqual(summary.stickyNotes, createStickyOutline(texts, pages));
  assert.ok(!JSON.stringify(summary).includes("大事な計算"));
  await saveLocalNote({ file, noteId: id, expectedRevision: 1, strokesByPage: {}, textsByPage: { 2: [{ ...sticky, text: "更新" }] } });
  assert.equal((await loadNoteLibrary()).notes[0].stickyNotes![0].label, "更新");
  await saveLocalNote({ file, noteId: id, expectedRevision: 2, strokesByPage: {}, textsByPage: {} });
  assert.equal((await loadNoteLibrary()).notes[0].stickyNotes, undefined);
  await deleteSavedNote(id); assert.deepEqual((await loadNoteLibrary()).notes, []);
});

test("付箋のバックアップ復元から参照を再生成し、参照一覧自体はバックアップへ複製しない", async () => {
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: {}, textsByPage: texts, pages });
  const backup = await captureNoteBackup({ kind: "note", id });
  assert.equal(backup.schemaVersion, 3);
  assert.ok(!("stickyNotes" in backup.notes[0]));
  const decoded = await decodeNoteBackup(await encodeNoteBackup(backup));
  await restoreNoteBackup(decoded);
  const copies = (await loadNoteLibrary()).notes;
  assert.equal(copies.length, 2);
  assert.ok(copies.every((note) => JSON.stringify(note.stickyNotes) === JSON.stringify(createStickyOutline(texts, pages))));
});

async function seedV4() {
  const opening = indexedDB.open("overlay-local-notes", 4);
  opening.onupgradeneeded = () => { for (const name of ["notes", "pdfs", "folders", "noteSummaries"]) opening.result.createObjectStore(name, { keyPath: "id" }); };
  const db = await readRequest(opening);
  const tx = db.transaction(["notes", "pdfs", "noteSummaries"], "readwrite");
  const done = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  const summary = { id: "old", title: "旧資料", fileName: file.name, folderId: null, updatedAt: "date" };
  const content = { ...summary, strokesByPage: {}, textsByPage: texts, pages, headingsByPage: { 2: "見出し" }, revision: 7 };
  tx.objectStore("notes").add(content); tx.objectStore("pdfs").add({ id: "old", blob: file }); tx.objectStore("noteSummaries").add(summary);
  await done; db.close(); return content;
}

test("DB版4の本文・PDF・見出しを変更せず版5で参照だけ追加する", async () => {
  const original = await seedV4();
  const getAll = IDBObjectStore.prototype.getAll;
  const guarded = mock.method(IDBObjectStore.prototype, "getAll", function (this: IDBObjectStore, ...args: Parameters<typeof getAll>) {
    assert.ok(this.name !== "notes" && this.name !== "pdfs"); return getAll.apply(this, args);
  });
  assert.deepEqual((await loadNoteLibrary()).notes[0].stickyNotes, createStickyOutline(texts, pages)); guarded.mock.restore();
  const stored = await withLocalTransaction(["notes"], "readonly", async (tx) => {
    assert.equal(tx.db.version, 5); return readRequest(tx.objectStore("notes").get("old"));
  });
  assert.deepEqual(stored, original);
  assert.deepEqual(await (await loadLocalNote("old")).file.arrayBuffer(), await file.arrayBuffer());
  await assert.rejects(readRequest(indexedDB.open("overlay-local-notes", 4)), { name: "VersionError" });
});

test("版4からの一覧移行に失敗したら版更新ごと取り消し、再試行できる", async () => {
  await seedV4();
  const put = IDBObjectStore.prototype.put;
  const blocked = mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
    if (this.name === "noteSummaries") throw new DOMException("full", "QuotaExceededError"); return put.apply(this, args);
  });
  await assert.rejects(loadNoteLibrary(), /保存容量が不足/); blocked.mock.restore();
  const old = await readRequest(indexedDB.open("overlay-local-notes", 4)); assert.equal(old.version, 4); old.close();
  assert.deepEqual((await loadNoteLibrary()).notes[0].stickyNotes, createStickyOutline(texts, pages));
});
