import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { exportAnnotatedPdf } from "@/features/pdf-editor/exportAnnotatedPdf";
import { resolveNotePages, insertBlankPage, deleteNotePage } from "@/features/pdf-editor/notePages";
import type { TextNote } from "@/features/pdf-editor/types";

test("表示番号で回転ページ・白紙・文章を抜粋し、除外ページを取得せず元ノートを変更しない", async () => {
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= 3; number++) {
    const page = source.addPage([600, 800]);
    page.drawText(`SOURCE ${number}`, { font });
    if (number === 1) page.setRotation(degrees(90));
  }
  const bytes = new Uint8Array(await source.save());
  const file = new File([bytes], "lecture.pdf", { type: "application/pdf" });
  const original = await getDocument({ data: bytes.slice(), standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)) }).promise;
  const pages = deleteNotePage(insertBlankPage(resolveNotePages(undefined, 3), 1, 800, 600, 3), 2);
  // 表示番号[1,2,3]とID[1,4,3]は異なる。最後の元ページは出力しない。
  const note: TextNote = { id: "sticky", kind: "sticky", text: "試験前に確認", x: 0.1, y: 0.1, width: 0.4, fontSize: 16 };
  const texts = { 4: [note] };
  const strokes = { 1: [{ width: 3, points: [{ x: 0.2, y: 0.3 }, { x: 0.7, y: 0.3 }] }] };
  const snapshot = JSON.stringify({ pages, texts, strokes });
  const visited: number[] = [];
  const getPage = original.getPage.bind(original);
  const spy = mock.method(original, "getPage", async (number: number) => { visited.push(number); return getPage(number); });
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(readFileSync(new URL("../public/fonts/NotoSansJP-Regular.otf", import.meta.url))));
  try {
    const output = await exportAnnotatedPdf(file, original, strokes, texts, pages, [2, 1, 2]);
    const loaded = await PDFDocument.load(output);
    assert.equal(loaded.getPageCount(), 2); assert.equal(loaded.getPage(0).getRotation().angle, 90);
    assert.deepEqual(loaded.getPage(1).getSize(), { width: 800, height: 600 });
    const rendered = await getDocument({ data: output.slice() }).promise;
    try {
      const textAt = async (number: number) => (await (await rendered.getPage(number)).getTextContent()).items.map((item) => "str" in item ? item.str : "").join("");
      assert.match(await textAt(1), /SOURCE 1/);
      assert.match(await textAt(2), /試験前に確認/);
    } finally { await rendered.loadingTask.destroy(); }
    assert.deepEqual(visited, [1]);
    assert.equal(JSON.stringify({ pages, texts, strokes }), snapshot);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
    const blankOnly = await PDFDocument.load(await exportAnnotatedPdf(file, original, strokes, texts, pages, [2]));
    assert.equal(blankOnly.getPageCount(), 1); assert.equal(blankOnly.getPage(0).getRotation().angle, 0);
    await assert.rejects(exportAnnotatedPdf(file, original, {}, {}, pages, []));
    await assert.rejects(exportAnnotatedPdf(file, original, {}, {}, pages, [4]));
  } finally { spy.mock.restore(); fetchMock.mock.restore(); await original.loadingTask.destroy(); }
});

test("除外ページの文章用フォントを抜粋PDFへ埋め込まない", async () => {
  const source = await PDFDocument.create(); source.addPage(); source.addPage();
  const file = new File([new Uint8Array(await source.save())], "notes.pdf");
  const original = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("除外した文章のフォント取得は禁止"); });
  try {
    const texts = { 1: [{ id: "omitted", kind: "text" as const, text: "出力対象外", x: 0.1, y: 0.1, width: 0.4, fontSize: 16 }] };
    const output = await exportAnnotatedPdf(file, original, {}, texts, undefined, [2]);
    assert.equal((await PDFDocument.load(output)).getPageCount(), 1);
    assert.ok(output.byteLength < 30_000); assert.equal(fetchMock.mock.callCount(), 0);
  } finally { fetchMock.mock.restore(); await original.loadingTask.destroy(); }
});
