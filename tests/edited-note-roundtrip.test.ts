import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { saveLocalNote, loadLocalNote, captureNoteBackup, restoreNoteBackup, loadNoteLibrary } from "@/features/pdf-editor/localNotes";
import { encodeNoteBackup, decodeNoteBackup } from "@/features/pdf-editor/noteBackupFile";
import { exportAnnotatedPdf } from "@/features/pdf-editor/exportAnnotatedPdf";
import { imageFixture } from "./image-fixture";
import type { NotePage } from "@/features/pdf-editor/types";

test("画像・色付きテープ・日本語・白紙をまとめて復元し、PDFと抜粋はテープなしで出力する", async () => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  const source = await PDFDocument.create();
  source.addPage([200, 200]); source.addPage([200, 200]);
  const file = new File([new Uint8Array(await source.save())], "mixed.pdf", { type: "application/pdf" });
  // 元PDFの2ページ目を外し、固定ID 3の白紙を表示番号2へ挿入する。
  const pages: NotePage[] = [{ id: 1, kind: "pdf", pageNumber: 1 }, { id: 3, kind: "blank", width: 200, height: 200 }];
  const images = await imageFixture();
  images.byPage = { 3: images.byPage[1] };
  const tapesByPage = { 3: [{ id: "mask", x: .1, y: .1, width: .4, height: .4, color: "#fb923c" }] };
  const strokesByPage = { 3: [{ width: 4, color: "#00ff00", points: [{ x: .1, y: .6 }, { x: .5, y: .6 }] }] };
  const textsByPage = { 3: [{ id: "memo", kind: "sticky" as const, text: "復習", x: .1, y: .75, width: .5, fontSize: 16 }] };
  const id = await saveLocalNote({ file, noteId: null, strokesByPage, textsByPage, pages, images, tapesByPage });
  const backup = await decodeNoteBackup(await encodeNoteBackup(await captureNoteBackup({ kind: "note", id })));
  assert.equal(backup.schemaVersion, 6);
  const before = await loadLocalNote(id);
  // 別の保存領域へ移す。元のノートを消して復元成功に見せない。
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  assert.deepEqual(await restoreNoteBackup(backup), { notes: 1, folders: 0 });
  const restoredId = (await loadNoteLibrary()).notes[0].id;
  const restored = await loadLocalNote(restoredId);
  for (const key of ["pages", "strokesByPage", "textsByPage", "tapesByPage"] as const) assert.deepEqual(restored[key], before[key]);
  assert.deepEqual(restored.images?.byPage, before.images?.byPage);
  const assetId = Object.keys(images.assets)[0];
  assert.deepEqual(await restored.images!.assets[assetId].blob.arrayBuffer(), await images.assets[assetId].blob.arrayBuffer());
  assert.deepEqual(await restored.file.arrayBuffer(), await file.arrayBuffer());
  assert.equal((await restoreNoteBackup(backup, { skipDuplicates: true })).notes, 0);
  const font = mock.method(globalThis, "fetch", async () => new Response(readFileSync(new URL("../public/fonts/NotoSansJP-Regular.otf", import.meta.url))));
  const original = await getDocument({ data: new Uint8Array(await restored.file.arrayBuffer()) }).promise;
  try {
    for (const selection of [undefined, [2]]) {
      const bytes = await exportAnnotatedPdf(restored.file, original, restored.strokesByPage, restored.textsByPage, restored.pages, selection, restored.images);
      const output = await getDocument({ data: bytes }).promise;
      try {
        assert.equal(output.numPages, selection ? 1 : 2);
        const page = await output.getPage(output.numPages);
        const text = (await page.getTextContent()).items.map(item => "str" in item ? item.str : "").join("");
        assert.match(text, /復習/);
        const factory = output.canvasFactory as {
          create(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D };
          destroy(target: unknown): void;
        };
        const target = factory.create(200, 200);
        try {
          await page.render({ canvas: target.canvas, canvasContext: target.context, viewport: page.getViewport({ scale: 1 }) }).promise;
          const pixel = (x: number, y: number) => [...target.context.getImageData(x, y, 1, 1).data].slice(0, 3);
          assert.deepEqual(pixel(35, 35), [255, 0, 0], "テープで覆った元画像もPDFでは見える");
          assert.deepEqual(pixel(85, 35), [0, 0, 255]);
          assert.deepEqual(pixel(35, 120), [0, 255, 0], "画像と同じ白紙に描いた線を保持");
        } finally { factory.destroy(target); }
      } finally { await output.loadingTask.destroy(); }
    }
    const after = await loadLocalNote(restoredId);
    assert.deepEqual({ ...after, file: null, images: null }, { ...restored, file: null, images: null }, "出力で保存内容を変えない");
    assert.deepEqual(await after.file.arrayBuffer(), await restored.file.arrayBuffer());
  } finally { font.mock.restore(); await original.loadingTask.destroy(); }
});
