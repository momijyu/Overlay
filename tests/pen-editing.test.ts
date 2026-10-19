import assert from "node:assert/strict";
import test from "node:test";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream, rgb } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { eraseStrokes } from "@/features/pdf-editor/eraseStrokes";
import { exportAnnotatedPdf } from "@/features/pdf-editor/exportAnnotatedPdf";
import { readStrokes } from "@/features/pdf-editor/strokeData";
import type { PenPoint, PenStroke } from "@/features/pdf-editor/types";

const line: PenStroke = { width: 2, color: "#ff0000", points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] };
const center = { x: 0.5, y: 0.5 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("点が疎な線も触れた部分だけ分割し、残りの位置・太さ・色を維持する", () => {
  const original = structuredClone(line);
  const result = eraseStrokes([line], center, center, 100, 100, 10, 1);
  assert.equal(result.length, 2);
  near(result[0].points.at(-1)!.x, 0.39);
  near(result[1].points[0].x, 0.61);
  assert.deepEqual(result[0].points[0], line.points[0]);
  assert.deepEqual(result[1].points.at(-1), line.points.at(-1));
  assert.ok(result.every((stroke) => stroke.width === 2 && stroke.color === "#ff0000"));
  assert.deepEqual(line, original);
});

test("消しゴムを速く動かしても、移動途中を通過した部分が消える", () => {
  const result = eraseStrokes([line], { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, 100, 100, 5, 1);
  assert.equal(result.length, 2);
  near(result[0].points.at(-1)!.x, 0.44);
  near(result[1].points[0].x, 0.56);
});

test("消しゴムの移動方向を逆にしても同じ部分が消える", () => {
  const a = { x: 0.25, y: 0.2 }, b = { x: 0.75, y: 0.8 };
  assert.deepEqual(eraseStrokes([line], a, b, 200, 300, 12, 1), eraseStrokes([line], b, a, 200, 300, 12, 1));
});

test("端の部分消去と全消去、点・重複点の消去にも対応する", () => {
  const result = eraseStrokes([line], { x: 0.1, y: 0.5 }, { x: 0.1, y: 0.5 }, 100, 100, 10, 1);
  assert.equal(result.length, 1);
  near(result[0].points[0].x, 0.21);
  assert.deepEqual(eraseStrokes([line], center, center, 100, 100, 100, 1), []);
  for (const points of [[center], [center, center]]) {
    assert.deepEqual(eraseStrokes([{ ...line, points }], center, center, 100, 100, 5, 1), []);
  }
});

test("消しゴムが触れていない線は同じ参照で返し、不要な自動保存を発生させない", () => {
  const strokes = [line];
  const away = { x: 0.5, y: 0.1 };
  assert.equal(eraseStrokes(strokes, away, away, 100, 100, 5, 1), strokes);
  assert.equal(eraseStrokes(strokes, center, center, 0, 100, 5, 1), strokes);
});

test("縦長・横長ページでも表示距離で判定し、倍率を変えても同じPDF上の範囲が消える", () => {
  assert.equal(eraseStrokes([line], { x: 0.5, y: 0.65 }, { x: 0.5, y: 0.65 }, 400, 100, 10, 1).length, 1);
  const a = eraseStrokes([line], center, center, 200, 300, 10, 1);
  const b = eraseStrokes([line], center, center, 400, 600, 20, 2);
  assert.deepEqual(a, b);
});

test("一度切った線をもう一度消しても、切れ目を再接続せず色を維持する", () => {
  const first = eraseStrokes([line], center, center, 100, 100, 5, 1);
  const point = { x: 0.25, y: 0.5 };
  const result = eraseStrokes(first, point, point, 100, 100, 5, 1);
  assert.equal(result.length, 3);
  assert.ok(result.every((stroke) => stroke.color === line.color));
  assert.ok(result.every((stroke) => !stroke.points.some((p) => p.x > 0.45 && p.x < 0.55)));
});

test("折れ線と複数の線を部分消去し、非接触の線や元データを壊さない", () => {
  const bent: PenStroke = { ...line, points: [{ x: 0.1, y: 0.2 }, center, { x: 0.9, y: 0.2 }] };
  const other = { ...line, color: "#0000ff", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] };
  const strokes = [bent, other];
  const original = structuredClone(strokes);
  const result = eraseStrokes(strokes, center, center, 100, 100, 10, 1);
  assert.equal(result.length, 3);
  assert.equal(result.at(-1), other);
  assert.deepEqual(strokes, original);
});

test("異なる形状の部分消去後も、残った線分が消しゴムの移動跡をまたがない", () => {
  let seed = 42;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  function distance(p: PenPoint, a: PenPoint, b: PenPoint) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  for (let attempt = 0; attempt < 80; attempt++) {
    const stroke = { ...line, points: Array.from({ length: 6 }, () => ({ x: random(), y: random() })) };
    const from = { x: random(), y: random() }, to = { x: random(), y: random() };
    const result = eraseStrokes([stroke], from, to, 200, 300, 10, 1);
    assert.deepEqual(readStrokes({ 1: result })[1], result);
    for (const fragment of result) {
      for (let index = 1; index < fragment.points.length; index++) {
        const a = fragment.points[index - 1], b = fragment.points[index];
        for (let sample = 0; sample <= 10; sample++) {
          const t = sample / 10;
          const p = { x: (a.x + (b.x - a.x) * t) * 200, y: (a.y + (b.y - a.y) * t) * 300 };
          assert.ok(distance(p, { x: from.x * 200, y: from.y * 300 }, { x: to.x * 200, y: to.y * 300 }) >= 11 - 1e-6);
        }
      }
    }
  }
});

test("色なしの旧線と6桁の色を読み込み、不正な色は保存・描画へ渡さない", () => {
  const legacy = { width: 2, points: line.points };
  assert.deepEqual(readStrokes({ 1: [legacy, line] }), { 1: [legacy, line] });
  for (const color of [null, 1, "red", "#fff", "#gg0000", "url(test)", "#ff0000ff"]) {
    assert.throws(() => readStrokes({ 1: [{ ...line, color }] }), /書き込み情報/);
  }
  const colored = { ...line, color: "#Ab12Cd" };
  assert.deepEqual(readStrokes({ 1: [colored] })[1][0], colored);
});

test("PDF出力に線ごとの色と消去後の切れ目を反映し、元PDFを変更しない", async () => {
  const original = await PDFDocument.create();
  original.addPage([200, 300]).drawLine({ start: { x: 0, y: 20 }, end: { x: 100, y: 20 }, color: rgb(0, 1, 0) });
  const bytes = await original.save();
  const file = new File([new Uint8Array(bytes)], "pen.pdf");
  const displayed = { numPages: 1, getPage: async () => ({ getViewport: () => ({
    width: 200, height: 300, convertToPdfPoint: (x: number, y: number) => [x, 300 - y],
  }) }) } as unknown as PDFDocumentProxy;
  const fragments = eraseStrokes([line], center, center, 200, 300, 10, 1);
  const output = await exportAnnotatedPdf(file, displayed, { 1: [...fragments,
    { ...line, color: "#0000ff", points: [{ x: 0.2, y: 0.2 }] },
    { width: 2, points: [{ x: 0.1, y: 0.8 }, { x: 0.9, y: 0.8 }] },
  ] });
  const pdf = await PDFDocument.load(output);
  const contents = pdf.getPage(0).node.Contents();
  assert.ok(contents instanceof PDFArray);
  const operators = Array.from({ length: contents.size() }, (_, index) => {
    const stream = pdf.context.lookup(contents.get(index));
    assert.ok(stream instanceof PDFRawStream);
    return new TextDecoder().decode(decodePDFRawStream(stream).decode());
  }).join("\n");
  assert.match(operators, /0 1 0 RG/); // 元PDFの緑線も維持。
  assert.match(operators, /1 0 0 RG/);
  assert.match(operators, /0 0 1 rg/);
  assert.match(operators, /20 150 m/);
  const coordinates = [...operators.matchAll(/^([\d.-]+) ([\d.-]+) ([ml])$/gm)];
  assert.ok(coordinates.some((match) => Math.abs(Number(match[1]) - 89) < 1e-8 && Number(match[2]) === 150 && match[3] === "l"));
  assert.ok(coordinates.some((match) => Math.abs(Number(match[1]) - 111) < 1e-8 && Number(match[2]) === 150 && match[3] === "m"));
  assert.match(operators, /180 150 l/);
  assert.match(operators, /0\.06666666666666667 0\.09411764705882353 0\.15294117647058825 RG/);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
});
