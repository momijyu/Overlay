import assert from "node:assert/strict";
import { test } from "node:test";
import { fillEnclosedRegion, eraseFilledRegion } from "@/features/pdf-editor/fillRegion";
import { createShapeStroke } from "@/features/pdf-editor/shapeStrokes";
import { readStrokes } from "@/features/pdf-editor/strokeData";
import { eraseStrokes } from "@/features/pdf-editor/eraseStrokes";
import type { PenPoint, PenStroke } from "@/features/pdf-editor/types";

const box = (left = .1, top = .1, right = .9, bottom = .9) => createShapeStroke("rectangle", { x: left, y: top }, { x: right, y: bottom }, 100, 100, 2, "#111827")!;
function inside(point: PenPoint, polygon: PenPoint[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (point.y - a.y) / (b.y - a.y) * (b.x - a.x)) result = !result;
  }
  return result;
}

test("閉じた線の内側だけを輪郭として保存し、ページ外・線上・開いた囲みは塗らない", () => {
  const outline = box();
  const fill = fillEnclosedRegion([outline], { x: .5, y: .5 }, 100, 100, "#ff0000");
  assert.equal(fill.kind, "fill"); assert.equal(fill.color, "#ff0000");
  assert.ok(fill.points.length < 20); assert.ok(inside({ x: .5, y: .5 }, fill.points));
  assert.equal(inside({ x: .05, y: .05 }, fill.points), false);
  assert.deepEqual(fill.points[0], fill.points.at(-1));
  assert.deepEqual(readStrokes({ 1: [fill] })[1], [fill]);
  assert.throws(() => readStrokes({ 1: [{ ...fill, points: fill.points.slice(0, -1) }] }));
  assert.throws(() => readStrokes({ 1: [{ ...fill, points: [{ x: 0, y: 0 }] }] }));
  for (const p of [{ x: .05, y: .05 }, { x: .1, y: .5 }]) assert.throws(() => fillEnclosedRegion([outline], p, 100, 100, "#ff0000"), /内側/);
  assert.throws(() => fillEnclosedRegion([{ ...outline, points: outline.points.slice(0, -1) }], { x: .5, y: .5 }, 100, 100, "#ff0000"), /囲まれた/);
  assert.equal(outline.kind, undefined);
});

test("複数の手書き線で閉じた凹形と分割領域を塗れる。マーカー・既存の塗りは境界にしない", () => {
  const points = [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .4 }, { x: .4, y: .4 }, { x: .4, y: .9 }, { x: .1, y: .9 }, { x: .1, y: .1 }];
  const strokes: PenStroke[] = points.slice(1).map((p, i) => ({ width: 1, points: [points[i], p] }));
  const fill = fillEnclosedRegion(strokes, { x: .2, y: .7 }, 100, 100, "#00ff00");
  assert.ok(inside({ x: .2, y: .7 }, fill.points)); assert.equal(inside({ x: .7, y: .7 }, fill.points), false);
  const divided = fillEnclosedRegion([box(), { width: 2, points: [{ x: .5, y: .1 }, { x: .5, y: .9 }] }], { x: .3, y: .5 }, 100, 100, "#00ff00");
  assert.equal(inside({ x: .7, y: .5 }, divided.points), false);
  assert.throws(() => fillEnclosedRegion([{ ...box(), kind: "marker" }, fill], { x: .5, y: .5 }, 100, 100, "#00ff00"), /囲まれた/);
});

test("輪の内側に別の囲みがある場合は穴を保ち、楕円・細線・大きなページでも閉じる", () => {
  const fill = fillEnclosedRegion([box(), box(.35, .35, .65, .65)], { x: .2, y: .5 }, 100, 100, "#0000ff");
  assert.ok(inside({ x: .2, y: .5 }, fill.points)); assert.equal(inside({ x: .5, y: .5 }, fill.points), false);
  const circle = createShapeStroke("ellipse", { x: .2, y: .2 }, { x: .8, y: .8 }, 10000, 10000, 1, "#111827")!;
  const ovalFill = fillEnclosedRegion([circle], { x: .5, y: .5 }, 10000, 10000, "#ff0000");
  assert.ok(inside({ x: .5, y: .5 }, ovalFill.points)); assert.equal(inside({ x: .22, y: .22 }, ovalFill.points), false);
  assert.ok(ovalFill.points.length < 5000);
});

test("塗った内部を部分消去でき、穴・分割・完全消去と未変更の参照を保つ", () => {
  const fill = fillEnclosedRegion([box()], { x: .5, y: .5 }, 100, 100, "#ff0000");
  const same = eraseFilledRegion(fill, { x: .01, y: .01 }, { x: .02, y: .02 }, 100, 100, 2);
  assert.equal(same, fill);
  const erased = eraseStrokes([fill], { x: .5, y: .5 }, { x: .5, y: .5 }, 100, 100, 5, 1);
  assert.deepEqual(eraseStrokes([fill], { x: .5, y: .5 }, { x: .5, y: .5 }, 200, 200, 10, 2), erased);
  assert.equal(erased.length, 1); assert.equal(erased[0].kind, "fill");
  assert.equal(inside({ x: .5, y: .5 }, erased[0].points), false);
  assert.ok(inside({ x: .2, y: .2 }, erased[0].points));
  const split = eraseFilledRegion(fill, { x: .5, y: 0 }, { x: .5, y: 1 }, 100, 100, 5)!;
  assert.equal(inside({ x: .5, y: .5 }, split.points), false);
  assert.ok(inside({ x: .2, y: .5 }, split.points)); assert.ok(inside({ x: .8, y: .5 }, split.points));
  assert.equal(eraseFilledRegion(fill, { x: .5, y: .5 }, { x: .5, y: .5 }, 100, 100, 100), null);
  assert.ok(inside({ x: .5, y: .5 }, fill.points));
});
