import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { exportAnnotatedPdf } from "@/features/pdf-editor/exportAnnotatedPdf";
import { imageFixture } from "./image-fixture";

test("元画素を保った画像PDFの回転・切り抜き・重なり・白紙・抜粋を実描画で確認する", async () => {
  const source = await PDFDocument.create(); source.addPage([200,200]); source.addPage([200,200]).setRotation(degrees(90));
  const bytes = new Uint8Array(await source.save());
  const file = new File([bytes], "images.pdf", { type: "application/pdf" });
  const original = await getDocument({ data: bytes.slice() }).promise;
  const images = await imageFixture(), image = images.byPage[1][0];
  images.byPage[2] = [{ ...image, id: "rotated", rotation: 90 }];
  images.byPage[3] = [{ ...image, id: "crop", crop: { x: .5, y: 0, width: .5, height: 1 } }];
  const pages = [{ id: 1, kind: "pdf" as const, pageNumber: 1 }, { id: 2, kind: "pdf" as const, pageNumber: 2 }, { id: 3, kind: "blank" as const, width: 200, height: 200 }];
  try {
    const output = await exportAnnotatedPdf(file, original, { 1: [{ width: 10, color: "#00ff00", points: [{ x: .1,y: .3 },{x: .5,y: .3}] }] }, {}, pages, undefined, images);
    const rendered = await getDocument({ data: output.slice() }).promise;
    const factory = rendered.canvasFactory as { create(w: number,h: number): {canvas: HTMLCanvasElement;context: CanvasRenderingContext2D}; destroy(value: unknown): void };
    const pixel = (ctx: CanvasRenderingContext2D,x: number,y: number) => [...ctx.getImageData(x,y,1,1).data].slice(0,3);
    try {
      for (const [number, samples] of [
        [1, [[35,35,[255,0,0]],[85,35,[0,0,255]],[35,85,[0,255,0]],[85,85,[255,255,255]],[35,60,[0,255,0]]]],
        [2, [[35,35,[0,255,0]],[85,35,[255,0,0]],[35,85,[255,255,255]],[85,85,[0,0,255]]]],
        [3, [[35,35,[0,0,255]],[85,35,[0,0,255]],[35,85,[255,255,255]],[15,35,[255,255,255]]]],
      ] as const) {
        const page = await rendered.getPage(number), viewport = page.getViewport({ scale: 1 });
        const target = factory.create(200,200);
        try { await page.render({ canvas: target.canvas, canvasContext: target.context, viewport }).promise;
          for (const [x,y,color] of samples) assert.deepEqual(pixel(target.context,x,y), [...color], `page ${number} (${x},${y})`);
        } finally { factory.destroy(target); }
      }
      const loaded = await PDFDocument.load(output);
      const objects = loaded.context.enumerateIndirectObjects().filter(([,obj]) => "dict" in obj && String((obj as {dict: unknown}).dict).includes("/Subtype /Image"));
      assert.equal(objects.length,1, "同じ元画像をページごとに埋め込み直さない");
      assert.match(String((objects[0][1] as unknown as {dict: unknown}).dict), /\/Width 2/);
    } finally { await rendered.loadingTask.destroy(); }
    const excerpt = await PDFDocument.load(await exportAnnotatedPdf(file, original, {}, {}, pages, [3], images));
    assert.equal(excerpt.getPageCount(),1);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()),bytes);
  } finally { await original.loadingTask.destroy(); }
});
