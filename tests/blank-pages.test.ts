import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readNotePages, resolveNotePages, insertBlankPage, checkPageBindings, MAX_NOTE_PAGES } from "@/features/pdf-editor/notePages";
import { createStrokeHistory, recordPageInsertion, recordStrokeEdit, recordTextEdit, undoStrokeEdit, redoStrokeEdit } from "@/features/pdf-editor/strokeHistory";
import { createLocalAutosave, type LocalSaveInput } from "@/features/pdf-editor/localAutosave";
import { saveLocalNote, loadLocalNote, captureNoteBackup, captureSelectedNoteBackup, restoreNoteBackup, loadNoteLibrary, createNoteFolder, moveSavedNote } from "@/features/pdf-editor/localNotes";
import { encodeNoteBackup, decodeNoteBackup } from "@/features/pdf-editor/noteBackupFile";
import { readNoteBackup } from "@/features/pdf-editor/noteBackupData";
import { exportAnnotatedPdf } from "@/features/pdf-editor/exportAnnotatedPdf";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
import type { TextNote } from "@/features/pdf-editor/types";

const originals = resolveNotePages(undefined, 2);
const pages = insertBlankPage(originals, 1, 800, 600);
const stroke = { width: 3, color: "#ff0000", points: [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.3 }] };
const text: TextNote = { id: "text", kind: "text", text: "計算メモ", x: 0.1, y: 0.1, width: 0.4, fontSize: 16 };
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const first = pdf.addPage([600, 800]); first.setRotation(degrees(90)); first.drawText("ORIGINAL ONE", { font });
pdf.addPage([500, 700]).drawText("ORIGINAL TWO", { font });
const file = new File([new Uint8Array(await pdf.save())], "講義.pdf", { type: "application/pdf" });

beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => {
    assert.equal(url, "/fonts/NotoSansJP-Regular.otf");
    return new Response(readFileSync(new URL("../public/fonts/NotoSansJP-Regular.otf", import.meta.url)));
  });
});
afterEach(() => mock.restoreAll());

test("途中・白紙の後・末尾へ挿入しても元ページIDと順序を変えない", () => {
  assert.deepEqual(pages.map((page) => page.id), [1, 3, 2]);
  const second = insertBlankPage(pages, 3, 800, 600);
  const last = insertBlankPage(second, 2, 500, 700);
  assert.deepEqual(last.map((page) => page.id), [1, 3, 4, 2, 5]);
  assert.deepEqual(originals, [{ id: 1, kind: "pdf", pageNumber: 1 }, { id: 2, kind: "pdf", pageNumber: 2 }]);
  checkPageBindings(last, [{ 2: [stroke], 4: [] }], 2);
});

test("重複ID・元ページのID不一致や順序変更・不正サイズ・未知の書き込み先を拒否する", () => {
  const bad = [[], Array(2), [...pages, pages[0]], [{ id: 1, kind: "pdf", pageNumber: 2 }],
    [...originals, { id: 3, kind: "blank", width: 0, height: 800 }],
    [...originals, { id: 3, kind: "blank", width: Infinity, height: 800 }],
    [...originals, { id: 3, kind: "blank", width: 600, height: 14_401 }],
    [...originals, { id: 3, kind: "image", width: 600, height: 800 }]];
  for (const value of bad) assert.throws(() => readNotePages(value));
  assert.throws(() => resolveNotePages(pages, 3));
  assert.throws(() => checkPageBindings(pages, [{ 4: [] }], 2));
  assert.throws(() => checkPageBindings(undefined, [{ 3: [] }], 2));
  assert.throws(() => insertBlankPage(originals, 9, 600, 800));
  const full = resolveNotePages(undefined, MAX_NOTE_PAGES);
  assert.throws(() => insertBlankPage(full, 1, 600, 800), /10,000/);
});

test("ページ挿入・線・文章を同じ履歴で戻し、白紙Undoは直前ページ、Redoは同じ白紙へ移る", () => {
  let history = createStrokeHistory({ 2: [stroke] });
  history = recordPageInsertion(history, originals, pages, 1, 3);
  history = recordStrokeEdit(history, 3, [stroke]);
  history = recordTextEdit(history, 3, [text]);
  const final = history;
  history = undoStrokeEdit(history); assert.deepEqual(history.textsByPage, {});
  history = undoStrokeEdit(history); assert.equal(history.strokesByPage[3], undefined);
  history = undoStrokeEdit(history); assert.deepEqual(history.pages, originals); assert.equal(history.changedPage, 1);
  history = redoStrokeEdit(history); assert.deepEqual(history.pages, pages); assert.equal(history.changedPage, 3);
  history = redoStrokeEdit(redoStrokeEdit(history));
  assert.deepEqual(history.strokesByPage, final.strokesByPage); assert.deepEqual(history.textsByPage, final.textsByPage);
  assert.deepEqual(history.strokesByPage[2], [stroke]);
  const revised = recordStrokeEdit(undoStrokeEdit(history), 3, []);
  assert.equal(revised.future.length, 0);
});

test("白紙だけの追加も初回自動保存し、遅い保存中のUndoを次のスナップショットで反映する", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const inputs: LocalSaveInput[] = [];
  const strokes = {}, texts = {};
  const autosave = createLocalAutosave({ file, noteId: null, strokesByPage: strokes, textsByPage: texts,
    persist: async (input) => { inputs.push(input); if (inputs.length === 1) await gate; return saveLocalNote(input); }, onChange: () => {} });
  assert.equal(await autosave.flush(), true); assert.equal(inputs.length, 0);
  autosave.update(strokes, texts, pages); await new Promise(setImmediate);
  autosave.update(strokes, texts, originals); release();
  assert.equal(await autosave.flush(), true);
  assert.equal(inputs.length, 2); assert.equal(inputs[1].noteId, autosave.getState().noteId);
  const loaded = await loadLocalNote(autosave.getState().noteId!);
  assert.deepEqual(loaded.pages, originals);
  assert.deepEqual(await loaded.file.arrayBuffer(), await file.arrayBuffer());
  autosave.dispose();
});

test("ページ構成・書き込みをDBへ保存し、更新・旧API・読込・不正更新のロールバックで保つ", async () => {
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: { 2: [stroke], 3: [stroke] }, textsByPage: { 3: [text] }, pages });
  await saveLocalNote({ file, noteId: id, expectedRevision: 1, strokesByPage: { 2: [stroke] } });
  const loaded = await loadLocalNote(id);
  assert.deepEqual(loaded.pages, pages); assert.deepEqual(loaded.textsByPage, { 3: [text] });
  await assert.rejects(saveLocalNote({ file, noteId: id, expectedRevision: 2, strokesByPage: { 4: [stroke] } }));
  assert.equal((await loadLocalNote(id)).revision, 2);
  await assert.rejects(saveLocalNote({ file, noteId: id, expectedRevision: 1, strokesByPage: {}, pages: originals }));
  assert.deepEqual((await loadLocalNote(id)).pages, pages);
  assert.deepEqual(await loaded.file.arrayBuffer(), await file.arrayBuffer());
});

test("白紙の保存失敗でも変更を保持し、再試行後に同じノートを保存できる", async () => {
  let fail = true;
  const autosave = createLocalAutosave({ file, noteId: null, strokesByPage: {},
    persist: async (input) => { if (fail) throw new DOMException("容量不足", "QuotaExceededError"); return saveLocalNote(input); }, onChange: () => {} });
  autosave.update({}, {}, pages);
  assert.equal(await autosave.flush(), false); assert.equal(autosave.hasPendingChanges(), true);
  assert.equal((await loadNoteLibrary()).notes.length, 0);
  fail = false;
  assert.equal(await autosave.flush(true), true);
  assert.deepEqual((await loadLocalNote(autosave.getState().noteId!)).pages, pages);
  assert.equal((await loadNoteLibrary()).notes.length, 1); autosave.dispose();
});

test("挿入前の履歴まで戻すとページ構成未定義にも戻せ、保存に白紙が残らない", async () => {
  const initial = createStrokeHistory({});
  const drawn = recordStrokeEdit(initial, 2, [stroke]);
  const added = recordPageInsertion(drawn, originals, pages, 1, 3);
  const undone = undoStrokeEdit(undoStrokeEdit(added));
  assert.equal(undone.pages, undefined);
  const autosave = createLocalAutosave({ file, noteId: null, strokesByPage: {}, persist: saveLocalNote, onChange: () => {} });
  autosave.update(added.strokesByPage, added.textsByPage, added.pages); await autosave.flush();
  autosave.update(undone.strokesByPage, undone.textsByPage, undone.pages); await autosave.flush();
  const reopened = await loadLocalNote(autosave.getState().noteId!);
  assert.equal(reopened.pages, undefined); assert.deepEqual(reopened.strokesByPage, {}); autosave.dispose();
});

test("単独・フォルダ・選択ZIPで白紙とその編集を復元し、旧形式への混入は拒否する", async () => {
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: { 3: [stroke] }, textsByPage: { 3: [text] }, pages });
  const folder = await createNoteFolder("講義", null); await moveSavedNote(id, folder);
  for (const input of [await captureNoteBackup({ kind: "note", id }), await captureNoteBackup({ kind: "folder", id: folder }),
    await captureSelectedNoteBackup([{ kind: "folder", id: folder }, { kind: "note", id }])]) {
    assert.equal(input.schemaVersion, 3);
    const decoded = await decodeNoteBackup(await encodeNoteBackup(input));
    assert.deepEqual(decoded.notes[0].pages, pages);
    assert.deepEqual(await decoded.notes[0].pdf.arrayBuffer(), await file.arrayBuffer());
    await restoreNoteBackup(decoded);
    const copy = (await loadNoteLibrary()).notes.find((note) => note.id !== id)!;
    assert.deepEqual((await loadLocalNote(copy.id)).pages, pages);
    assert.deepEqual((await loadLocalNote(copy.id)).textsByPage, { 3: [text] });
    assert.throws(() => readNoteBackup({ ...input, schemaVersion: input.kind === "selection" ? 2 : 1 }));
  }
});

test("Driveコピーの重複判定は白紙の有無・位置・大きさも比較する", async () => {
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  const old = await captureNoteBackup({ kind: "note", id });
  assert.equal((await restoreNoteBackup(old, { skipDuplicates: true })).skippedNotes, 1);
  const changed = readNoteBackup({ ...old, schemaVersion: 3, notes: [{ ...old.notes[0], pages }] });
  assert.equal((await restoreNoteBackup(changed, { skipDuplicates: true })).notes, 1);
  assert.equal((await restoreNoteBackup(changed, { skipDuplicates: true })).skippedNotes, 1);
  const resized = { ...changed, notes: [{ ...changed.notes[0], pages: insertBlankPage(originals, 1, 700, 600) }] };
  assert.equal((await restoreNoteBackup(resized, { skipDuplicates: true })).notes, 1);
});

test("ページ構成と実PDFの枚数が違うバックアップは書き出さず、DBへ追加しない", async () => {
  const bad = readNoteBackup({ schemaVersion: 3, kind: "note", name: "bad", folders: [], notes: [{ id: "bad", title: "bad",
    fileName: file.name, folderId: null, pdf: file, strokesByPage: {}, textsByPage: {}, pages: resolveNotePages(undefined, 3) }] });
  await assert.rejects(encodeNoteBackup(bad), /ページ数/);
  assert.equal((await loadNoteLibrary()).notes.length, 0);
});

test("回転PDFの直後に同じ表示寸法の白紙を出力し、日本語・付箋・線と後続ページを維持する", async () => {
  const displayed = await getDocument({ standardFontDataUrl: fileURLToPath(new URL("../public/pdfjs/standard_fonts/", import.meta.url)), data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true }).promise;
  try {
    const originalBytes = await file.arrayBuffer();
    const output = await exportAnnotatedPdf(file, displayed, { 2: [stroke], 3: [stroke] },
      { 3: [text, { ...text, id: "sticky", kind: "sticky", text: "確認", y: 0.5 }] }, pages);
    const parsed = await getDocument({ standardFontDataUrl: fileURLToPath(new URL("../public/pdfjs/standard_fonts/", import.meta.url)), data: output.slice(), disableFontFace: true }).promise;
    try {
      assert.equal(parsed.numPages, 3);
      const view = (await parsed.getPage(2)).getViewport({ scale: 1 });
      assert.equal(view.width, 800); assert.equal(view.height, 600);
      const strings = async (page: number) => (await (await parsed.getPage(page)).getTextContent()).items.flatMap((item) => "str" in item ? [item.str] : []).join("");
      assert.match(await strings(1), /ORIGINAL ONE/);
      assert.match(await strings(2), /計算メモ/); assert.match(await strings(2), /確認/);
      assert.match(await strings(3), /ORIGINAL TWO/);
      const result = await PDFDocument.load(output);
      assert.ok(result.getPage(1).node.Contents()); assert.ok(result.getPage(2).node.Contents());
    } finally { await parsed.loadingTask.destroy(); }
    assert.deepEqual(await file.arrayBuffer(), originalBytes);
    const unmarked = await PDFDocument.load(await exportAnnotatedPdf(file, displayed, {}, {}, pages));
    assert.equal(unmarked.getPageCount(), 3); // 未記入の白紙も省略しない。
    await assert.rejects(exportAnnotatedPdf(file, displayed, { 4: [stroke] }, {}, pages));
  } finally { await displayed.loadingTask.destroy(); }
});

test("旧DB版2の元PDFと本文を変えず版8へ移行し、旧版での再接続は拒否する", async () => {
  const opening = indexedDB.open("overlay-local-notes", 2);
  opening.onupgradeneeded = () => { for (const name of ["notes", "pdfs", "folders", "noteSummaries"]) opening.result.createObjectStore(name, { keyPath: "id" }); };
  const legacy = await readRequest(opening);
  const tx = legacy.transaction(["notes", "pdfs"], "readwrite");
  const complete = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  tx.objectStore("notes").add({ id: "legacy", title: "legacy", fileName: file.name, folderId: null, updatedAt: "2026-11-04", strokesByPage: { 2: [stroke] } });
  tx.objectStore("pdfs").add({ id: "legacy", blob: file }); await complete; legacy.close();
  const loaded = await loadLocalNote("legacy");
  assert.equal(loaded.pages, undefined); assert.deepEqual(loaded.strokesByPage, { 2: [stroke] });
  assert.deepEqual(await loaded.file.arrayBuffer(), await file.arrayBuffer());
  assert.equal(await withLocalTransaction(["notes"], "readonly", async (tx) => tx.db.version), 8);
  await assert.rejects(readRequest(indexedDB.open("overlay-local-notes", 2)), { name: "VersionError" });
});
