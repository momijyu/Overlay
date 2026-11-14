import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { testPng } from "./image-fixture";

let loading: Record<string, unknown> | undefined;
let destroyed = 0;
let load: () => Promise<unknown> = async () => ({ numPages: 2 });
mock.module("pdfjs-dist/legacy/build/pdf.mjs", { exports: {
  GlobalWorkerOptions: {},
  getDocument(options: Record<string, unknown>) {
    loading = options;
    return { promise: load(), destroy: async () => { destroyed++; } };
  },
} });
const { openPdfForImage, renderPdfImage, pdfImageScale, PDF_IMAGE_MAX_BYTES } = await import("@/features/pdf-editor/pdfImageImport");
const original = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  load = async () => ({ numPages: 2 }); loading = undefined; destroyed = 0;
});

test("PDFは読込前の容量検査と同梱フォント設定を行い、パスワード・取消時に解放する", async () => {
  await assert.rejects(openPdfForImage({ size: PDF_IMAGE_MAX_BYTES + 1, arrayBuffer() { throw new Error("read"); } } as unknown as File, new AbortController().signal), /50MiB/);
  const file = new File(["%PDF"], "資料.pdf");
  assert.equal((await openPdfForImage(file, new AbortController().signal)).numPages, 2);
  assert.equal(loading!.cMapUrl, "/pdfjs/cmaps/");
  assert.equal(loading!.standardFontDataUrl, "/pdfjs/standard_fonts/");
  load = async () => { const error = new Error(); error.name = "PasswordException"; throw error; };
  await assert.rejects(openPdfForImage(file, new AbortController().signal), /パスワード付き/);
  assert.equal(destroyed, 1);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(openPdfForImage(file, abort.signal), { name: "AbortError" });
});

test("PDF画像の解像度は倍率・端末サイズに依存せず、巨大ページも寸法と画素数を制限する", () => {
  assert.equal(pdfImageScale(595, 842), 2);
  for (const [width, height] of [[10000, 10000], [10000, 100], [100, 10000]]) {
    const scale = pdfImageScale(width, height);
    assert.ok(width * scale <= 4096 && height * scale <= 4096);
    assert.ok(width * scale * height * scale <= 8_000_001);
  }
  assert.throws(() => pdfImageScale(Infinity, 1));
  assert.throws(() => pdfImageScale(0, 1));
});

function fixture(blob: Blob, render: () => { promise: Promise<void>; cancel(): void } = () => ({ promise: Promise.resolve(), cancel() {} })) {
  let cleaned = 0;
  const pages: number[] = [];
  const canvas = { width: 0, height: 0, toBlob(callback: (value: Blob) => void) { callback(blob); } };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => canvas } });
  const pdf = { numPages: 2, getPage: async (number: number) => {
    pages.push(number);
    return { getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }), render,
      cleanup() { cleaned++; } };
  } } as unknown as PDFDocumentProxy;
  return { pdf, pages, canvas, cleaned: () => cleaned };
}

test("選択した1ページだけPNGへ変換し、既存画像用のハッシュ・寸法を返しcanvasを解放する", async () => {
  const f = fixture(testPng());
  const result = await renderPdfImage(f.pdf, 2, new AbortController().signal);
  assert.deepEqual(f.pages, [2]);
  assert.equal(result.asset.blob.type, "image/png");
  assert.equal(result.asset.width, 1190); assert.equal(result.asset.height, 1684);
  assert.match(result.id, /^[0-9a-f]{64}$/);
  assert.equal(f.cleaned(), 1); assert.equal(f.canvas.width, 0); assert.equal(f.canvas.height, 0);
  await assert.rejects(renderPdfImage(f.pdf, 3, new AbortController().signal), /ページ番号/);
});

test("変換取消とPNG容量超過は画像を返さず、描画・canvasを解放する", async () => {
  const abort = new AbortController();
  let cancelCount = 0;
  let fail!: (reason: unknown) => void;
  const f = fixture(testPng(), () => ({ promise: new Promise<void>((_, reject) => { fail = reject; }),
    cancel() { cancelCount++; fail(new DOMException("Cancelled", "AbortError")); } }));
  const pending = renderPdfImage(f.pdf, 1, abort.signal);
  await Promise.resolve(); abort.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelCount, 1); assert.equal(f.cleaned(), 1); assert.equal(f.canvas.width, 0);
  const large = fixture(new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: "image/png" }));
  await assert.rejects(renderPdfImage(large.pdf, 1, new AbortController().signal), /20MiB/);
  assert.equal(large.cleaned(), 1); assert.equal(large.canvas.width, 0);
});
