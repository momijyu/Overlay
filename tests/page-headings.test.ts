import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { PDFDocument } from "pdf-lib";
import { normalizeHeading, readPageHeadings, changePageHeading } from "@/features/pdf-editor/pageHeadings";
import { resolveNotePages, insertBlankPage } from "@/features/pdf-editor/notePages";
import { createStrokeHistory, recordHeadingEdit, recordPageInsertion, recordStrokeEdit, recordTextEdit, undoStrokeEdit, redoStrokeEdit } from "@/features/pdf-editor/strokeHistory";
import { createLocalAutosave, type LocalSaveInput } from "@/features/pdf-editor/localAutosave";
import { saveLocalNote, loadLocalNote, loadNoteLibrary, captureNoteBackup, captureSelectedNoteBackup, restoreNoteBackup, createNoteFolder, moveSavedNote } from "@/features/pdf-editor/localNotes";
import { readNoteBackup, type NoteBackup } from "@/features/pdf-editor/noteBackupData";
import { encodeNoteBackup, decodeNoteBackup } from "@/features/pdf-editor/noteBackupFile";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";

const pdf = await PDFDocument.create(); pdf.addPage([600, 800]); pdf.addPage([600, 800]);
const file = new File([new Uint8Array(await pdf.save())], "授業.pdf", { type: "application/pdf" });
const originalPages = resolveNotePages(undefined, 2);
const pages = insertBlankPage(originalPages, 1, 600, 800);
const stroke = { width: 2.5, points: [{ x: 0.1, y: 0.2 }] };
const headings = { 2: "テスト範囲", 3: "計算用紙" };
beforeEach(() => Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() }));

test("任意ページの見出しを追加・変更・削除し、同じ内容は変更として扱わない", () => {
  const empty = {};
  const added = changePageHeading(empty, 2, "  大事な公式  ");
  assert.deepEqual(added, { 2: "大事な公式" }); assert.deepEqual(empty, {});
  assert.equal(changePageHeading(added, 2, "大事な公式"), added);
  assert.equal(changePageHeading(empty, 1, " "), empty);
  assert.deepEqual(changePageHeading(added, 2, "別の公式"), { 2: "別の公式" });
  assert.deepEqual(changePageHeading(added, 2, ""), {});
  assert.equal(normalizeHeading("あ".repeat(120)), "あ".repeat(120));
});

test("不正なキー・空見出し・複数行・長文・未対応形式を拒否し、旧データは空で読む", () => {
  assert.deepEqual(readPageHeadings(undefined), {});
  assert.deepEqual(readPageHeadings({ 2: " 数式 " }), { 2: "数式" });
  for (const value of [null, [], "text", { 0: "bad" }, { "01": "bad" }, { [Number.MAX_SAFE_INTEGER + 1]: "bad" },
    { 1: 123 }, { 1: " " }, { 1: "a\nb" }, { 1: "a\u0000b" }, { 1: "a\u2028b" }, { 1: "あ".repeat(121) }]) {
    assert.throws(() => readPageHeadings(value));
  }
  assert.throws(() => changePageHeading({}, 0, "bad"));
});

test("見出し・白紙挿入・手書き・文章を同じ履歴で戻し、元ページへの対応を維持する", () => {
  let history = createStrokeHistory({});
  history = recordHeadingEdit(history, 2, "公式");
  history = recordPageInsertion(history, originalPages, pages, 1, 3);
  assert.equal(history.headingsByPage[2], "公式");
  history = recordHeadingEdit(history, 3, "演習");
  history = recordStrokeEdit(history, 3, [stroke]);
  history = recordTextEdit(history, 3, [{ id: "note", kind: "text", text: "補足", x: 0.1, y: 0.2, width: 0.3, fontSize: 16 }]);
  const last = history;
  history = undoStrokeEdit(undoStrokeEdit(history)); assert.deepEqual(history.headingsByPage, { 2: "公式", 3: "演習" });
  history = undoStrokeEdit(history); assert.deepEqual(history.headingsByPage, { 2: "公式" }); assert.equal(history.changedPage, 3);
  history = undoStrokeEdit(history); assert.deepEqual(history.pages, originalPages);
  history = undoStrokeEdit(history); assert.deepEqual(history.headingsByPage, {});
  for (let index = 0; index < 5; index++) history = redoStrokeEdit(history);
  assert.deepEqual(history.headingsByPage, last.headingsByPage); assert.deepEqual(history.pages, last.pages);
  assert.deepEqual(history.strokesByPage, last.strokesByPage); assert.deepEqual(history.textsByPage, last.textsByPage);
  assert.equal(recordHeadingEdit(history, 2, "公式"), history);
  assert.equal(recordHeadingEdit(undoStrokeEdit(history), 2, "改訂").future.length, 0);
});

test("見出しだけで初回保存し、遅い保存中の変更・削除を直列保存する", async () => {
  const strokes = {}, texts = {}, empty = {};
  const inputs: LocalSaveInput[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const autosave = createLocalAutosave({ file, noteId: null, strokesByPage: strokes, textsByPage: texts, headingsByPage: empty,
    persist: async (input) => { inputs.push(input); if (inputs.length === 1) await gate; return saveLocalNote(input); }, onChange: () => {} });
  await autosave.flush(); assert.equal(inputs.length, 0);
  autosave.update(strokes, texts, undefined, { 2: "重要" }); await new Promise(setImmediate);
  autosave.update(strokes, texts, undefined, {}); release();
  assert.equal(await autosave.flush(), true); assert.equal(inputs.length, 2);
  assert.deepEqual(inputs[0].headingsByPage, { 2: "重要" }); assert.deepEqual(inputs[1].headingsByPage, {});
  assert.equal(inputs[1].noteId, autosave.getState().noteId);
  const loaded = await loadLocalNote(autosave.getState().noteId!);
  assert.equal(loaded.headingsByPage, undefined); assert.deepEqual(await loaded.file.arrayBuffer(), await file.arrayBuffer()); autosave.dispose();
});

test("見出し保存失敗は変更を保持し、手動再試行で保存できる", async () => {
  let fail = true;
  const autosave = createLocalAutosave({ file, noteId: null, strokesByPage: {},
    persist: async (input) => { if (fail) throw new Error("容量不足"); return saveLocalNote(input); }, onChange: () => {} });
  autosave.update({}, {}, undefined, { 1: "重要" }); assert.equal(await autosave.flush(), false);
  assert.equal(autosave.hasPendingChanges(), true); assert.equal((await loadNoteLibrary()).notes.length, 0);
  fail = false; assert.equal(await autosave.flush(true), true);
  assert.deepEqual((await loadLocalNote(autosave.getState().noteId!)).headingsByPage, { 1: "重要" }); autosave.dispose();
});

test("DBへ白紙・見出し・元の線を保存し、旧API更新でも見出しを保持、競合や不正入力を拒否する", async () => {
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: { 2: [stroke] }, pages, headingsByPage: headings });
  await saveLocalNote({ file, noteId: id, expectedRevision: 1, strokesByPage: { 2: [stroke], 3: [stroke] } });
  const reopened = await loadLocalNote(id);
  assert.deepEqual(reopened.headingsByPage, headings); assert.deepEqual(reopened.pages, pages);
  assert.deepEqual(reopened.strokesByPage[2], [stroke]); assert.deepEqual(await reopened.file.arrayBuffer(), await file.arrayBuffer());
  await assert.rejects(saveLocalNote({ file, noteId: id, expectedRevision: 2, strokesByPage: {}, pages, headingsByPage: { 4: "不明" } }));
  await assert.rejects(saveLocalNote({ file, noteId: id, expectedRevision: 1, strokesByPage: {}, headingsByPage: {} }));
  assert.deepEqual((await loadLocalNote(id)).headingsByPage, headings);
  await saveLocalNote({ file, noteId: id, expectedRevision: 2, strokesByPage: reopened.strokesByPage, headingsByPage: {} });
  assert.equal((await loadLocalNote(id)).headingsByPage, undefined);
});

test("単独・フォルダ・選択ZIPは版4で見出しも復元し、見出しのない版1〜3も維持する", async () => {
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: { 3: [stroke] }, pages, headingsByPage: headings });
  const folder = await createNoteFolder("講義", null); await moveSavedNote(id, folder);
  for (const input of [await captureNoteBackup({ kind: "note", id }), await captureNoteBackup({ kind: "folder", id: folder }),
    await captureSelectedNoteBackup([{ kind: "folder", id: folder }, { kind: "note", id }])]) {
    assert.equal(input.schemaVersion, 4);
    const decoded = await decodeNoteBackup(await encodeNoteBackup(input));
    assert.deepEqual(decoded.notes[0].headingsByPage, headings); assert.deepEqual(decoded.notes[0].pages, pages);
    await restoreNoteBackup(decoded);
    const copy = (await loadNoteLibrary()).notes.find((note) => note.id !== id)!;
    assert.deepEqual((await loadLocalNote(copy.id)).headingsByPage, headings);
    assert.throws(() => readNoteBackup({ ...input, schemaVersion: 3 }));
  }
  for (const version of [1, 2, 3] as const) {
    const backup = readNoteBackup({ schemaVersion: version, kind: version === 2 ? "selection" : "note", name: "旧版", folders: [], notes: [{
      id: "old", title: "旧版", fileName: file.name, folderId: null, pdf: file, strokesByPage: {}, textsByPage: {}, ...(version === 3 ? { pages } : {}),
    }] });
    const decoded = await decodeNoteBackup(await encodeNoteBackup(backup));
    assert.equal(decoded.schemaVersion, version); assert.equal(decoded.notes[0].headingsByPage, undefined);
  }
});

test("見出しが異なるDriveコピーを追加し、同じ見出し・PDF・編集なら追加しない", async () => {
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: {}, pages, headingsByPage: headings });
  const backup = await captureNoteBackup({ kind: "note", id });
  assert.equal((await restoreNoteBackup(backup, { skipDuplicates: true })).skippedNotes, 1);
  const different: NoteBackup = { ...backup, notes: [{ ...backup.notes[0], headingsByPage: { ...headings, 2: "別の見出し" } }] };
  assert.equal((await restoreNoteBackup(different, { skipDuplicates: true })).notes, 1);
  assert.equal((await restoreNoteBackup(different, { skipDuplicates: true })).skippedNotes, 1);
});

test("元PDFに存在しない見出しを含むバックアップは出力せず、DBの不正な見出しも読み込まない", async () => {
  const invalid = readNoteBackup({ schemaVersion: 4, kind: "note", name: "不正", folders: [], notes: [{ id: "bad", title: "不正",
    fileName: file.name, folderId: null, pdf: file, strokesByPage: {}, textsByPage: {}, headingsByPage: { 9: "存在しない" } }] });
  await assert.rejects(encodeNoteBackup(invalid)); assert.equal((await loadNoteLibrary()).notes.length, 0);
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: {}, pages });
  await withLocalTransaction(["notes"], "readwrite", async (tx) => {
    const row = await readRequest<Record<string, unknown>>(tx.objectStore("notes").get(id));
    await readRequest(tx.objectStore("notes").put({ ...row, headingsByPage: { 9: "存在しない" } }));
  });
  await assert.rejects(loadLocalNote(id));
});

test("DB版3のページと編集本文を保持して版5へ更新し、古いタブの再接続を拒否する", async () => {
  const opening = indexedDB.open("overlay-local-notes", 3);
  opening.onupgradeneeded = () => { for (const name of ["notes", "pdfs", "folders", "noteSummaries"]) opening.result.createObjectStore(name, { keyPath: "id" }); };
  const old = await readRequest(opening);
  const tx = old.transaction(["notes", "pdfs"], "readwrite");
  const complete = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  tx.objectStore("notes").add({ id: "old", title: "旧", fileName: file.name, folderId: null, updatedAt: "2026-11-04", strokesByPage: { 3: [stroke] }, pages });
  tx.objectStore("pdfs").add({ id: "old", blob: file }); await complete; old.close();
  const loaded = await loadLocalNote("old");
  assert.deepEqual(loaded.pages, pages); assert.deepEqual(loaded.strokesByPage, { 3: [stroke] }); assert.equal(loaded.headingsByPage, undefined);
  assert.deepEqual(await loaded.file.arrayBuffer(), await file.arrayBuffer());
  assert.equal(await withLocalTransaction(["notes"], "readonly", async (tx) => tx.db.version), 7);
  await assert.rejects(readRequest(indexedDB.open("overlay-local-notes", 3)), { name: "VersionError" });
});
