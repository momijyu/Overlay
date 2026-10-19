import type { PenPoint, PenStroke } from "./types";

type Interval = [number, number];
const EPSILON = 1e-10;

// 1本の線分を始点t=0・終点t=1で表し、円の内側にある範囲を求める。
function insideCircle(a: PenPoint, b: PenPoint, center: PenPoint, radius: number): Interval | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const x = a.x - center.x, y = a.y - center.y;
  const lengthSquared = dx * dx + dy * dy;
  const c = x * x + y * y - radius * radius;
  if (lengthSquared === 0) return c <= 0 ? [0, 1] : null;
  const projection = x * dx + y * dy;
  const discriminant = projection * projection - lengthSquared * c;
  if (discriminant <= 0) return null;
  const root = Math.sqrt(discriminant);
  const start = Math.max(0, (-projection - root) / lengthSquared);
  const end = Math.min(1, (-projection + root) / lengthSquared);
  return end - start > EPSILON ? [start, end] : null;
}

function insideRange(start: number, delta: number, minimum: number, maximum: number): Interval | null {
  if (Math.abs(delta) < EPSILON) return start >= minimum && start <= maximum ? [0, 1] : null;
  const a = (minimum - start) / delta, b = (maximum - start) / delta;
  const from = Math.max(0, Math.min(a, b)), to = Math.min(1, Math.max(a, b));
  return to - from > EPSILON ? [from, to] : null;
}

// 消しゴムの移動跡は「両端の円＋間の長方形」。点と点の間も判定し、速い移動で消し残さない。
function erasedIntervals(a: PenPoint, b: PenPoint, from: PenPoint, to: PenPoint, radius: number): Interval[] {
  const intervals: Interval[] = [];
  for (const center of [from, to]) {
    const interval = insideCircle(a, b, center, radius);
    if (interval) intervals.push(interval);
  }
  const dx = to.x - from.x, dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length > EPSILON) {
    const ux = dx / length, uy = dy / length;
    const x = a.x - from.x, y = a.y - from.y;
    const sx = b.x - a.x, sy = b.y - a.y;
    const along = insideRange(x * ux + y * uy, sx * ux + sy * uy, 0, length);
    const across = insideRange(-x * uy + y * ux, -sx * uy + sy * ux, -radius, radius);
    if (along && across) {
      const start = Math.max(along[0], across[0]), end = Math.min(along[1], across[1]);
      if (end - start > EPSILON) intervals.push([start, end]);
    }
  }
  // 重なった消去範囲をまとめる。
  const merged: Interval[] = [];
  for (const interval of intervals.sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1] + EPSILON) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}

function pointAt(a: PenPoint, b: PenPoint, t: number): PenPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// pageWidth/Heightとradiusは表示上のpx。保存する座標は従来どおり0〜1の割合に戻す。
// 元PDF・入力配列は変更せず、消えた部分だけを除いた線を返す。何も消えなければ同じ配列を返す。
export function eraseStrokes(
  strokes: PenStroke[], from: PenPoint, to: PenPoint,
  pageWidth: number, pageHeight: number, radius: number, pageScale: number,
): PenStroke[] {
  if (![pageWidth, pageHeight, radius, pageScale].every((value) => Number.isFinite(value) && value > 0)) return strokes;
  if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) return strokes;
  const pixels = (point: PenPoint): PenPoint => ({ x: point.x * pageWidth, y: point.y * pageHeight });
  const start = pixels(from), end = pixels(to);
  let changed = false;
  const result = strokes.flatMap((stroke) => {
    const fragments: PenPoint[][] = [];
    let current: PenPoint[] = [];
    let cut = false;
    const paddedRadius = radius + stroke.width * pageScale / 2;
    const flush = () => { if (current.length) fragments.push(current); current = []; };
    // 点だけの書き込みも、長さ0の線分として消せる。
    const points = stroke.points.length === 1 ? [stroke.points[0], stroke.points[0]] : stroke.points;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index];
      const erased = erasedIntervals(pixels(a), pixels(b), start, end, paddedRadius);
      if (erased.length) cut = true;
      const kept: Interval[] = [];
      let cursor = 0;
      for (const [left, right] of erased) {
        if (left - cursor > EPSILON) kept.push([cursor, left]);
        cursor = Math.max(cursor, right);
      }
      if (1 - cursor > EPSILON) kept.push([cursor, 1]);
      if (!kept.length) flush();
      for (const [left, right] of kept) {
        if (left > EPSILON) flush();
        if (!current.length) current.push(pointAt(a, b, left));
        current.push(pointAt(a, b, right));
        if (right < 1 - EPSILON) flush();
      }
    }
    flush();
    if (!cut) return [stroke];
    changed = true;
    return fragments.map((points) => ({ ...stroke, points }));
  });
  return changed ? result : strokes;
}
