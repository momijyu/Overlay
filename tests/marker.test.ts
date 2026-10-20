import assert from "node:assert/strict";
import test from "node:test";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readStrokes } from "@/features/pdf-editor/strokeData";
import { eraseStrokes } from "@/features/pdf-editor/eraseStrokes";
import { exportAnnotatedPdf } from "@/features/pdf-editor/exportAnnotatedPdf";
import { MARKER_OPACITY } from "@/features/pdf-editor/penStyle";
import { createStrokeHistory, recordStrokeEdit, undoStrokeEdit, redoStrokeEdit } from "@/features/pdf-editor/strokeHistory";
import type { PenStroke } from "@/features/pdf-editor/types";

const marker: PenStroke = { kind: "marker", color: "#facc15", width: 16,
  points: [{ x: 0.1, y: 0.5 }, { x: 0.4, y: 0.5 }, { x: 0.7, y: 0.5 }, { x: 0.9, y: 0.5 }] };

test("マーカー種別を複製して読み込み、旧ペンは変更せず、不正な種別を拒否する", () => {
  const legacy: PenStroke = { width: 2.5, points: marker.points };
  const input = { 1: [marker, legacy, { ...legacy, kind: "pen" as const }] };
  const read = readStrokes(input);
  assert.deepEqual(read, input);
  assert.notEqual(read[1][0], marker);
  assert.equal(read[1][1].kind, undefined);
  for (const kind of [null, 0, "eraser", "unknown", {}]) {
    assert.throws(() => readStrokes({ 1: [{ ...marker, kind }] }), /書き込み情報/);
  }
});

test("マーカーも部分消去でき、種類・太さ・色と混在Undo・Redoを保持する", () => {
  const pen: PenStroke = { width: 2.5, color: "#111827", points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }] };
  const original = structuredClone(marker);
  const center = { x: 0.5, y: 0.5 };
  const strokes = [pen, marker];
  const fragments = eraseStrokes(strokes, center, center, 400, 600, 12, 1);
  assert.equal(fragments.length, 3);
  assert.equal(fragments[0], pen);
  assert.ok(fragments.slice(1).every((stroke) => stroke.kind === "marker" && stroke.width === 16 && stroke.color === marker.color));
  assert.deepEqual(marker, original);
  const drawn = recordStrokeEdit(createStrokeHistory({ 1: [pen] }), 1, strokes);
  const erased = recordStrokeEdit(drawn, 1, fragments);
  const undone = undoStrokeEdit(erased);
  assert.deepEqual(undone.strokesByPage[1], strokes);
  assert.deepEqual(undoStrokeEdit(undone).strokesByPage[1], [pen]);
  assert.deepEqual(redoStrokeEdit(undone).strokesByPage[1], fragments);
});

test("回転PDFでもマーカーを1本のパスで半透明・乗算出力し、タップも同じ濃さで出力する", async () => {
  const source = await PDFDocument.create();
  for (const angle of [0, 90, 180, 270]) source.addPage([400, 600]).setRotation(degrees(angle));
  const original = new Uint8Array(await source.save());
  const file = new File([original], "marker.pdf");
  const displayed = await getDocument({ data: original.slice() }).promise;
  try {
    const strokes = Object.fromEntries([1, 2, 3, 4].map((page) => [page, [marker,
      { ...marker, points: [{ x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2 }] }]]));
    const output = await exportAnnotatedPdf(file, displayed, strokes);
    const pdf = await PDFDocument.load(output);
    for (let index = 0; index < 4; index++) {
      const page = pdf.getPage(index);
      const contents = page.node.Contents();
      assert.ok(contents instanceof PDFArray);
      const operators = Array.from({ length: contents.size() }, (_, i) => {
        const stream = pdf.context.lookup(contents.get(i));
        assert.ok(stream instanceof PDFRawStream);
        return new TextDecoder().decode(decodePDFRawStream(stream).decode());
      }).join("\n");
      assert.equal([...operators.matchAll(/^S$/gm)].length, 1); // 分割線分ではなく、一度だけ描く。
      assert.match(operators, /1 0 0 -1 0 0 cm/);
      assert.match(operators, /1 j/); // 線の継ぎ目も丸くする。
      const viewport = (await displayed.getPage(index + 1)).getViewport({ scale: 1 });
      const [x, y] = viewport.convertToPdfPoint(marker.points[0].x * viewport.width, marker.points[0].y * viewport.height);
      assert.ok(operators.includes(`${x} ${-y} m`));
      const states = page.node.Resources()!.lookup(PDFName.of("ExtGState"), PDFDict);
      const values = states.values().map((value) => pdf.context.lookup(value, PDFDict));
      assert.ok(values.some((value) => value.lookupMaybe(PDFName.of("CA"), PDFNumber)?.asNumber() === MARKER_OPACITY));
      assert.ok(values.some((value) => value.lookupMaybe(PDFName.of("ca"), PDFNumber)?.asNumber() === MARKER_OPACITY));
      assert.ok(values.every((value) => value.lookup(PDFName.of("BM"), PDFName).asString() === "/Multiply"));
    }
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), original);
  } finally { await displayed.loadingTask.destroy(); }
});
