import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { paintThumbnailAnnotations, renderPageThumbnail } from "@/features/pdf-editor/renderPageThumbnail";

const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
  else Reflect.deleteProperty(globalThis, "document");
});
function canvasFixture() {
  const fills: unknown[][] = [], paths: number[][] = [], scales: number[][] = [], rules: unknown[] = [];
  const context = {
    drawImage: () => {}, scale: (...args: number[]) => scales.push(args), save: () => {}, restore: () => {},
    fillRect: (...args: number[]) => fills.push([context.fillStyle, ...args]),
    beginPath: () => {}, moveTo: (...args: number[]) => paths.push(args), lineTo: (...args: number[]) => paths.push(args),
    closePath: () => {}, stroke: () => {}, fill: (rule?: string) => rules.push(rule), arc: () => {},
    fillStyle: "", strokeStyle: "", lineWidth: 0, lineCap: "", lineJoin: "", globalAlpha: 1, globalCompositeOperation: "",
  };
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => canvas } });
  return { canvas, fills, paths, scales, rules };
}

test("縦横のPDFは最大128×136pxで描画し、元の寸法を保って書き込みを重ねる", async () => {
  for (const [width, height] of [[595, 842], [842, 595]]) {
    const { canvas, paths, scales, rules } = canvasFixture();
    const pdf = { getPage: async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale }),
      render: ({ viewport }: { viewport: { width: number; height: number } }) => {
        assert.ok(viewport.width <= 128 && viewport.height <= 136);
        return { promise: Promise.resolve(), cancel: () => {} };
      },
    }) } as unknown as PDFDocumentProxy;
    const signal = new AbortController().signal;
    const base = await renderPageThumbnail(pdf, { id: 2, kind: "pdf", pageNumber: 1 }, signal);
    assert.ok(canvas.width <= 128 && canvas.height <= 136);
    assert.equal(base.width, width); assert.equal(base.height, height);
    await paintThumbnailAnnotations(canvas, base, 2, [{ width: 5, kind: "fill", points: [{ x: .25, y: .5 }, { x: .5, y: .5 }] }], [], [], undefined, signal);
    assert.deepEqual(scales.at(-1), [canvas.width / width, canvas.height / height]);
    assert.deepEqual(paths[0], [width * .25, height * .5]);
    assert.deepEqual(rules, ["evenodd"]);
  }
});

test("方眼の白紙もPDF取得なしでプレビューを生成する", async () => {
  const { paths, fills } = canvasFixture();
  const pdf = { getPage: () => { throw new Error("元PDFを取得しない"); } } as unknown as PDFDocumentProxy;
  const result = await renderPageThumbnail(pdf, { id: 100, kind: "blank", width: 595, height: 842, template: "grid" }, new AbortController().signal);
  assert.equal(fills[0][0], "#fff"); assert.ok(paths.length > 10);
  assert.equal(result.width, 595); assert.equal(result.height, 842);
});

test("一覧の画面外へ出たPDF描画を中断し、すでに取り消した要求はPDFを取得しない", async () => {
  canvasFixture();
  let gets = 0, cancels = 0;
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
  const pdf = { getPage: async () => { gets++; return {
    getViewport: () => ({ width: 800, height: 600 }),
    render: () => ({ promise: pending, cancel: () => { cancels++; reject(new Error("中断")); } }),
  }; } } as unknown as PDFDocumentProxy;
  const controller = new AbortController();
  const rendering = renderPageThumbnail(pdf, { id: 1, kind: "pdf", pageNumber: 1 }, controller.signal);
  const rejected = assert.rejects(rendering, /中断/);
  await new Promise(setImmediate); controller.abort(); await rejected;
  assert.equal(cancels, 1);
  await assert.rejects(renderPageThumbnail(pdf, { id: 1, kind: "pdf", pageNumber: 1 }, controller.signal), { name: "AbortError" });
  assert.equal(gets, 1);
});
