import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { PDFDocument } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PenStroke } from "@/features/pdf-editor/types";
import { saveLocalNote, loadLocalNote } from "@/features/pdf-editor/localNotes";
import { exportAnnotatedPdf } from "@/features/pdf-editor/exportAnnotatedPdf";

const strokes: Record<number, PenStroke[]> = {
  1: [{ width: 1.5, points: [{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.8 }] }],
  2: [{ width: 5, points: [{ x: 1, y: 0 }] }],
};
beforeEach(() => {
  // 実ブラウザ・外部サービスへ接続せず、現行の保存→読み直し→PDF出力を検証する。
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  mock.method(globalThis, "fetch", () => { throw new Error("ローカル保存で通信を行ってはいけません。"); });
});
afterEach(() => mock.restoreAll());

test("復元した複数ページの線をPDFに出力しても、保存した元PDFは変わらない", async () => {
  const original = await PDFDocument.create();
  original.addPage([200, 300]);
  original.addPage([200, 300]);
  const bytes = await original.save();
  const originalFile = new File([new Uint8Array(bytes)], "two-pages.pdf", { type: "application/pdf" });
  const id = await saveLocalNote({ file: originalFile, strokesByPage: strokes, noteId: null });
  const loaded = await loadLocalNote(id);
  // PDF.jsの表示座標→PDF座標変換を、回転のない200×300ページとして再現する。
  const displayed = {
    numPages: 2,
    getPage: async () => ({ getViewport: () => ({
      width: 200, height: 300,
      convertToPdfPoint: (x: number, y: number) => [x, 300 - y],
    }) }),
  } as unknown as PDFDocumentProxy;
  const output = await exportAnnotatedPdf(loaded.file, displayed, loaded.strokesByPage);
  const exported = await PDFDocument.load(output);
  assert.equal(exported.getPageCount(), 2);
  assert(exported.getPages().every((page) => page.node.Contents()));
  assert.deepEqual(new Uint8Array(await loaded.file.arrayBuffer()), bytes);
  assert.deepEqual(new Uint8Array(await (await loadLocalNote(id)).file.arrayBuffer()), bytes);
});

test("目隠しテープを保存・再読込しても全体・指定ページPDFには描き込まない", async () => {
  const original = await PDFDocument.create();
  original.addPage([200, 300]).drawText("Answer: 42", { x: 20, y: 240, size: 12 });
  original.addPage([200, 300]).drawText("Answer: 7", { x: 20, y: 240, size: 12 });
  const file = new File([new Uint8Array(await original.save())], "answers.pdf", { type: "application/pdf" });
  const tapesByPage = { 1: [{ id: "answer", x: .05, y: .05, width: .8, height: .3 }] };
  const id = await saveLocalNote({ file, strokesByPage: {}, noteId: null, tapesByPage });
  const loaded = await loadLocalNote(id);
  assert.deepEqual(loaded.tapesByPage, tapesByPage);
  const displayed = { numPages: 2 } as PDFDocumentProxy;
  // テープを持つ復元済みノートも、通常の出力経路では線・文章・ページ・画像だけを渡す。
  for (const selection of [undefined, [1]]) {
    const withTape = await exportAnnotatedPdf(loaded.file, displayed, loaded.strokesByPage,
      loaded.textsByPage, loaded.pages, selection, loaded.images);
    const plain = await exportAnnotatedPdf(file, displayed, {}, undefined, loaded.pages, selection);
    assert.deepEqual(withTape, plain);
    assert.equal((await PDFDocument.load(withTape)).getPageCount(), selection?.length ?? 2);
  }
});
