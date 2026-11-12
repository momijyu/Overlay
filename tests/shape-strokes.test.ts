import assert from "node:assert/strict";
import test from "node:test";
import { createShapeStroke, SHAPE_OPTIONS } from "@/features/pdf-editor/shapeStrokes";
import { eraseStrokes } from "@/features/pdf-editor/eraseStrokes";
import { readStrokes } from "@/features/pdf-editor/strokeData";

const a = { x: .2, y: .3 }, b = { x: .8, y: .7 };
test("直線・矢印・四角・楕円を既存の線として検証・保存できる", () => {
  for (const { kind } of SHAPE_OPTIONS) {
    const stroke = createShapeStroke(kind, a, b, 600, 800, 32, "#123456")!;
    assert.deepEqual(readStrokes({ 1: [stroke] }), { 1: [stroke] });
    assert.equal(stroke.width, 32);
    assert.equal(stroke.color, "#123456");
    assert.ok(stroke.points.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1));
  }
});
test("逆方向でも四角は閉じた輪郭、楕円は指定範囲内の閉じた輪郭になる", () => {
  for (const [start, end] of [[a, b], [b, a]]) {
    const rect = createShapeStroke("rectangle", start, end, 600, 800, 2.5, "#111827")!;
    assert.equal(rect.points.length, 5);
    assert.deepEqual(rect.points[0], rect.points.at(-1));
    assert.deepEqual(rect.points[2], end);
    const oval = createShapeStroke("ellipse", start, end, 600, 800, 2.5, "#111827")!;
    assert.equal(oval.points.length, 65);
    assert.deepEqual(oval.points[0], oval.points.at(-1));
    const xs = oval.points.map((point) => point.x), ys = oval.points.map((point) => point.y);
    assert.ok(Math.abs(Math.min(...xs) - .2) < 1e-10);
    assert.ok(Math.abs(Math.max(...xs) - .8) < 1e-10);
    assert.ok(Math.abs(Math.min(...ys) - .3) < 1e-10);
    assert.ok(Math.abs(Math.max(...ys) - .7) < 1e-10);
  }
});
test("矢印の先端は離した位置で、羽根はPDFの実寸で左右対称になる", () => {
  const stroke = createShapeStroke("arrow", a, b, 300, 900, 2.5, "#111827")!;
  assert.deepEqual(stroke.points[0], a);
  assert.deepEqual(stroke.points[1], b);
  assert.deepEqual(stroke.points[3], b);
  const head = [stroke.points[2], stroke.points[4]].map((point) => Math.hypot((point.x - b.x) * 300, (point.y - b.y) * 900));
  assert.ok(Math.abs(head[0] - head[1]) < 1e-10);
});
test("極太図形の輪郭もページ端からはみ出さず、タップやつぶれた図形は作らない", () => {
  for (const { kind } of SHAPE_OPTIONS) {
    const stroke = createShapeStroke(kind, { x: -1, y: -1 }, { x: 2, y: 2 }, 100, 200, 32, "#111827")!;
    assert.ok(stroke.points.every((point) => point.x >= .16 - 1e-10 && point.x <= .84 + 1e-10 && point.y >= .08 - 1e-10 && point.y <= .92 + 1e-10));
    assert.equal(createShapeStroke(kind, a, a, 600, 800, 32, "#111827"), null);
    assert.equal(createShapeStroke(kind, a, b, 0, 800, 32, "#111827"), null);
    assert.equal(createShapeStroke(kind, a, { x: NaN, y: 1 }, 600, 800, 32, "#111827"), null);
  }
  for (const kind of ["rectangle", "ellipse"] as const) {
    assert.equal(createShapeStroke(kind, a, { x: a.x, y: .9 }, 600, 800, 2.5, "#111827"), null);
  }
});
test("図形も部分消去でき、残った線は同じ色と太さを維持する", () => {
  const stroke = createShapeStroke("rectangle", a, b, 600, 800, 32, "#123456")!;
  const remaining = eraseStrokes([stroke], { x: .5, y: 0 }, { x: .5, y: 1 }, 600, 800, 8, 1);
  assert.ok(remaining.length >= 2);
  assert.ok(remaining.every((part) => part.color === "#123456" && part.width === 32));
  assert.deepEqual(stroke.points[0], a);
});
