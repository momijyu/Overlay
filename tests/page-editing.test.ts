import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileURLToPath } from "node:url";
import { deleteNotePage, resolveNotePages, insertBlankPage, readNotePages, checkPageBindings } from "@/features/pdf-editor/notePages";
import { createStrokeHistory, recordPageClear, recordPageDeletion, undoStrokeEdit, redoStrokeEdit } from "@/features/pdf-editor/strokeHistory";
import { saveLocalNote, loadLocalNote, captureNoteBackup, restoreNoteBackup, loadNoteLibrary } from "@/features/pdf-editor/localNotes";
import { encodeNoteBackup, decodeNoteBackup } from "@/features/pdf-editor/noteBackupFile";
import { readDriveManifest } from "@/features/pdf-editor/googleDriveNoteData";
import { exportAnnotatedPdf } from "@/features/pdf-editor/exportAnnotatedPdf";
import type { TextNote } from "@/features/pdf-editor/types";

const originals = resolveNotePages(undefined, 3);
const pages = insertBlankPage(originals, 2, 600, 800, 3);
const stroke = { width: 3, points: [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.3 }] };
const marker = { ...stroke, kind: "marker" as const };
const text: TextNote = { id: "text", kind: "text", text: "本文", x: 0.1, y: 0.1, width: 0.4, fontSize: 16 };
const sticky: TextNote = { ...text, id: "sticky", kind: "sticky", text: "確認" };
const initial = createStrokeHistory({ 1: [stroke], 2: [stroke, marker], 4: [stroke] },
  { 1: [text], 2: [text, sticky], 4: [sticky] }, pages, { 2: "旧見出し", 4: "白紙" });

beforeEach(() => { Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() }); });

test("元ページと白紙を削除しても残ったIDを変えず、最後の1ページと未知のIDの削除を拒否する", () => {
  let remaining = deleteNotePage(pages, 2);
  assert.deepEqual(remaining.map((page) => page.id), [1, 4, 3]);
  remaining = deleteNotePage(deleteNotePage(remaining, 1), 3);
  assert.deepEqual(remaining.map((page) => page.id), [4]);
  assert.deepEqual(resolveNotePages(remaining, 3), remaining);
  assert.throws(() => deleteNotePage(remaining, 4), /最後の1ページ/);
  assert.throws(() => deleteNotePage(pages, 9));
  assert.deepEqual(deleteNotePage(pages, 4), originals);
  assert.deepEqual(pages.map((page) => page.id), [1, 2, 4, 3]);
});

test("元ページを抜いた構成も検証し、逆順・重複・PDF範囲外・白紙ID衝突と消えたページのメモを拒否する", () => {
  assert.deepEqual(readNotePages([originals[2]]), [originals[2]]);
  assert.deepEqual(resolveNotePages([originals[0]], 3), [originals[0]]);
  assert.throws(() => readNotePages([originals[2], originals[0]]));
  assert.throws(() => readNotePages([originals[0], originals[0]]));
  assert.throws(() => resolveNotePages([originals[2]], 2));
  assert.throws(() => resolveNotePages([{ id: 2, kind: "blank", width: 600, height: 800 }], 3));
  assert.throws(() => checkPageBindings(deleteNotePage(pages, 2), [{ 2: [stroke] }], 3));
  const inserted = insertBlankPage([originals[0]], 1, 600, 800, 3);
  assert.equal(inserted[1].id, 4); // 削除した元PDFのIDを白紙へ再利用しない。
});

for (const pageId of [1, 2, 4, 3]) test(`ページ${pageId}削除は関連メモだけを除き、Undo／Redoでページと全種類のメモを戻す`, () => {
  const deleted = recordPageDeletion(initial, pages, pageId);
  const expected = pages.filter((page) => page.id !== pageId);
  assert.deepEqual(deleted.pages, expected);
  assert.equal(deleted.strokesByPage[pageId], undefined);
  assert.equal(deleted.textsByPage[pageId], undefined);
  assert.equal(deleted.headingsByPage[pageId], undefined);
  assert.equal(deleted.changedPage, expected[Math.min(pages.findIndex((page) => page.id === pageId), expected.length - 1)].id);
  assert.equal(deleted.past.length, 1);
  const undo = undoStrokeEdit(deleted);
  assert.deepEqual(undo.pages, pages); assert.equal(undo.changedPage, pageId);
  assert.deepEqual(undo.strokesByPage, initial.strokesByPage);
  assert.deepEqual(undo.textsByPage, initial.textsByPage);
  assert.deepEqual(undo.headingsByPage, initial.headingsByPage);
  assert.deepEqual(redoStrokeEdit(undo).pages, deleted.pages);
  assert.deepEqual(redoStrokeEdit(undo).textsByPage, deleted.textsByPage);
  assert.deepEqual(initial.pages, pages); assert.ok(initial.textsByPage[2]);
});

for (let mask = 0; mask < 8; mask++) test(`一括削除の種類選択${mask}は表示ページだけに適用し、1回で戻す`, () => {
  const selection = { strokes: !!(mask & 1), sticky: !!(mask & 2), text: !!(mask & 4) };
  const cleared = recordPageClear(initial, 2, selection);
  assert.deepEqual(cleared.strokesByPage[2], selection.strokes ? [] : [stroke, marker]);
  assert.deepEqual(cleared.textsByPage[2], [text, sticky].filter((note) => !selection[note.kind]));
  assert.equal(cleared.strokesByPage[1], initial.strokesByPage[1]);
  assert.equal(cleared.textsByPage[4], initial.textsByPage[4]);
  assert.equal(cleared.pages, initial.pages); assert.equal(cleared.headingsByPage, initial.headingsByPage);
  if (!mask) assert.equal(cleared, initial);
  else {
    assert.equal(cleared.past.length, 1);
    const undo = undoStrokeEdit(cleared);
    assert.equal(undo.strokesByPage, initial.strokesByPage); assert.equal(undo.textsByPage, initial.textsByPage);
    assert.deepEqual(redoStrokeEdit(undo).textsByPage, cleared.textsByPage);
  }
});

test("存在しない種類・空ページを消しても履歴や保存用の更新番号を増やさない", () => {
  assert.equal(recordPageClear(initial, 3, { strokes: true, sticky: true, text: true }), initial);
  assert.equal(recordPageClear(initial, 1, { strokes: false, sticky: true, text: false }), initial);
});

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let index = 0; index < 3; index++) {
  const page = pdf.addPage([600, 800]);
  page.drawText(`SOURCE ${index + 1}`, { font });
  if (!index) page.setRotation(degrees(90));
}
const file = new File([new Uint8Array(await pdf.save())], "pages.pdf", { type: "application/pdf" });

test("削除構成と残ったメモをDB・バックアップ・Drive形式で保ち、元PDFを変更せず復元する", async () => {
  const deleted = recordPageDeletion(initial, pages, 2);
  const id = await saveLocalNote({ file, noteId: null, ...deleted });
  const loaded = await loadLocalNote(id);
  assert.deepEqual(loaded.pages, deleted.pages); assert.deepEqual(loaded.textsByPage, deleted.textsByPage);
  assert.deepEqual(await loaded.file.arrayBuffer(), await file.arrayBuffer());
  const backup = await decodeNoteBackup(await encodeNoteBackup(await captureNoteBackup({ kind: "note", id })));
  await restoreNoteBackup(backup);
  const copy = (await loadNoteLibrary()).notes.find((note) => note.id !== id)!;
  const restored = await loadLocalNote(copy.id);
  assert.deepEqual(restored.pages, deleted.pages); assert.deepEqual(restored.headingsByPage, deleted.headingsByPage);
  const manifest = readDriveManifest({ schemaVersion: 3, kind: "overlay-drive-note", noteKey: "note-key", title: "test", fileName: file.name,
    pdfId: "pdf-id", pdfBytes: file.size, strokesByPage: deleted.strokesByPage, textsByPage: deleted.textsByPage,
    pages: deleted.pages, headingsByPage: deleted.headingsByPage }, "note-key");
  assert.deepEqual(manifest.pages, deleted.pages); assert.deepEqual(manifest.textsByPage, deleted.textsByPage);
  assert.throws(() => readDriveManifest({ ...manifest, strokesByPage: initial.strokesByPage }, "note-key"));
});

test("PDF出力は削除した元ページを除外して白紙を残し、全部白紙でも出力できる", async () => {
  const options = { standardFontDataUrl: fileURLToPath(new URL("../public/pdfjs/standard_fonts/", import.meta.url)), disableFontFace: true };
  const displayed = await getDocument({ ...options, data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const source = await file.arrayBuffer();
  try {
    for (const remaining of [deleteNotePage(pages, 2), [pages[2]], [originals[0]]]) {
      const output = await exportAnnotatedPdf(file, displayed, { [remaining[0].id]: [stroke] }, {}, remaining);
      const parsed = await getDocument({ ...options, data: output.slice() }).promise;
      try {
        assert.equal(parsed.numPages, remaining.length);
        for (const [index, entry] of remaining.entries()) {
          const page = await parsed.getPage(index + 1);
          const words = (await page.getTextContent()).items.flatMap((item) => "str" in item ? [item.str] : []).join("");
          if (entry.kind === "pdf") assert.match(words, new RegExp(`SOURCE ${entry.pageNumber}`));
          else assert.equal(words, "");
        }
        if (remaining[0].kind === "pdf") assert.equal((await parsed.getPage(1)).rotate, 90);
        assert.ok((await PDFDocument.load(output)).getPage(0).node.Contents());
      } finally { await parsed.loadingTask.destroy(); }
    }
    assert.deepEqual(await file.arrayBuffer(), source);
  } finally { await displayed.loadingTask.destroy(); }
});
