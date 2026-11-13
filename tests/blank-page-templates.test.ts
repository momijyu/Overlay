import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { IDBFactory } from "fake-indexeddb";
import { PDFDocument, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { blankPageTemplateLines } from "@/features/pdf-editor/blankPageTemplate";
import { insertBlankPage, readNotePages, resolveNotePages } from "@/features/pdf-editor/notePages";
import { saveLocalNote, loadLocalNote, captureNoteBackup, restoreNoteBackup } from "@/features/pdf-editor/localNotes";
import { encodeNoteBackup, decodeNoteBackup } from "@/features/pdf-editor/noteBackupFile";
import { readDriveManifest } from "@/features/pdf-editor/googleDriveNoteData";
import { driveManifestContent, sha256 } from "@/features/pdf-editor/driveAutosaveRemote";
import { exportAnnotatedPdf } from "@/features/pdf-editor/exportAnnotatedPdf";

const original = resolveNotePages(undefined, 1);
const source = await PDFDocument.create();
source.addPage([600, 800]).setRotation(degrees(90));
const file = new File([new Uint8Array(await source.save())], "template.pdf", { type: "application/pdf" });
const options = { standardFontDataUrl: fileURLToPath(new URL("../public/pdfjs/standard_fonts/", import.meta.url)), disableFontFace: true };
beforeEach(() => Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() }));

test("旧白紙と明示的な無地を同じ形式で読み、未知のテンプレートは拒否する", () => {
  const plain = { id: 2, kind: "blank", width: 800, height: 600 };
  assert.deepEqual(readNotePages([plain]), [plain]);
  assert.deepEqual(readNotePages([{ ...plain, template: "plain" }]), [plain]);
  for (const template of [null, "unknown", 1, {}, []]) assert.throws(() => readNotePages([{ ...plain, template }]));
  assert.deepEqual(insertBlankPage(original, 1, 800, 600, 1), [...original, plain]);
});

test("罫線・方眼の背景は寸法内に収まり、小さい白紙や無地には線を作らない", () => {
  assert.deepEqual(blankPageTemplateLines(undefined, 800, 600), []);
  assert.deepEqual(blankPageTemplateLines("plain", 800, 600), []);
  assert.deepEqual(blankPageTemplateLines("grid", 40, 600), []);
  const ruled = blankPageTemplateLines("ruled", 800, 600), grid = blankPageTemplateLines("grid", 800, 600);
  assert.ok(ruled.length > 0); assert.ok(ruled.every((line) => line.y1 === line.y2));
  assert.equal(ruled[1].y1 - ruled[0].y1, 24);
  assert.equal(grid[1].y1 - grid[0].y1, 20); assert.ok(grid.some((line) => line.x1 === line.x2));
  for (const line of [...ruled, ...grid]) {
    assert.ok(line.x1 >= 24 && line.x2 <= 776 && line.y1 >= 24 && line.y2 <= 576);
  }
  assert.ok(blankPageTemplateLines("grid", 14_400, 14_400).length < 1_500);
});

test("方眼は端数のある縦横寸法でも全マスを閉じ、左右・上下の余白をそろえる", () => {
  for (const [width, height] of [[800, 600], [595.28, 841.89], [841.89, 595.28], [68, 68]]) {
    const lines = blankPageTemplateLines("grid", width, height);
    const horizontal = lines.filter((line) => line.y1 === line.y2);
    const vertical = lines.filter((line) => line.x1 === line.x2);
    const left = vertical[0].x1, right = vertical.at(-1)!.x1;
    const top = horizontal[0].y1, bottom = horizontal.at(-1)!.y1;
    assert.ok(Math.abs(left - (width - right)) < 1e-9);
    assert.ok(Math.abs(top - (height - bottom)) < 1e-9);
    assert.ok(left >= 24 && top >= 24);
    assert.ok(horizontal.every((line) => line.x1 === left && line.x2 === right));
    assert.ok(vertical.every((line) => line.y1 === top && line.y2 === bottom));
    for (const [index, line] of horizontal.entries()) assert.ok(Math.abs(line.y1 - top - index * 20) < 1e-9);
    for (const [index, line] of vertical.entries()) assert.ok(Math.abs(line.x1 - left - index * 20) < 1e-9);
  }
  assert.deepEqual(blankPageTemplateLines("grid", 67, 100), []);
  assert.deepEqual(blankPageTemplateLines("grid", 100, 67), []);
});

test("罫線・方眼をDB・編集用ZIP・Drive本文へ保持し、種類の異なるノートは重複扱いにしない", async () => {
  const pages = insertBlankPage(original, 1, 800, 600, 1, "ruled");
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: {}, pages });
  assert.deepEqual((await loadLocalNote(id)).pages, pages);
  const backup = await decodeNoteBackup(await encodeNoteBackup(await captureNoteBackup({ kind: "note", id })));
  assert.deepEqual(backup.notes[0].pages, pages);
  assert.equal((await restoreNoteBackup(backup, { skipDuplicates: true })).skippedNotes, 1);
  const gridPages = insertBlankPage(original, 1, 800, 600, 1, "grid");
  const grid = { ...backup, notes: [{ ...backup.notes[0], pages: gridPages }] };
  assert.equal((await restoreNoteBackup(grid, { skipDuplicates: true })).notes, 1);
  assert.equal((await restoreNoteBackup(grid, { skipDuplicates: true })).skippedNotes, 1);
  const makeManifest = (layout: typeof pages) => readDriveManifest({ schemaVersion: 2, kind: "overlay-drive-note", noteKey: "note_A",
    title: "Template", fileName: file.name, pdfId: "pdf_A", pdfBytes: file.size, strokesByPage: {}, textsByPage: {}, pages: layout }, "note_A");
  const ruled = makeManifest(pages), checkedGrid = makeManifest(gridPages);
  assert.deepEqual(ruled.pages, pages); assert.deepEqual(checkedGrid.pages, gridPages);
  assert.notEqual(await sha256(new Blob([JSON.stringify(driveManifestContent(ruled))])),
    await sha256(new Blob([JSON.stringify(driveManifestContent(checkedGrid))])));
  assert.deepEqual(await backup.notes[0].pdf.arrayBuffer(), await file.arrayBuffer());
});

test("未記入の罫線・方眼も全体と抜粋PDFへ出力し、元PDFを変更しない", async () => {
  const displayed = await getDocument({ ...options, data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const operators: number[] = [];
    for (const template of ["plain", "ruled", "grid"] as const) {
      const pages = insertBlankPage(original, 1, 800, 600, 1, template);
      for (const selected of [undefined, [2]]) {
        const bytes = await exportAnnotatedPdf(file, displayed, {}, {}, pages, selected);
        const result = await getDocument({ ...options, data: bytes.slice() }).promise;
        try {
          assert.equal(result.numPages, selected ? 1 : 2);
          const page = await result.getPage(selected ? 1 : 2);
          assert.equal(page.getViewport({ scale: 1 }).width, 800);
          assert.equal(page.getViewport({ scale: 1 }).height, 600);
          const count = (await page.getOperatorList()).fnArray.length;
          if (!selected) operators.push(count); else assert.equal(count, operators.at(-1));
        } finally { await result.loadingTask.destroy(); }
      }
    }
    assert.ok(operators[0] < operators[1] && operators[1] < operators[2]);
    assert.equal((await PDFDocument.load(await file.arrayBuffer())).getPageCount(), 1);
  } finally { await displayed.loadingTask.destroy(); }
});
