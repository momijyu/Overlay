import type { PenPoint, PenStroke } from "./types";

// ページの長辺を最大1024セルに制限。ズーム・端末の画素数で結果を変えず、画像は保存しない。
function grid(width: number, height: number) {
  const scale = Math.min(2, 1024 / Math.max(width, height));
  return { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)), scale };
}

/** マスクへ円形の端を持つ線分を走査線で描く。長い斜線でも外接四角形全体を走査しない。 */
function paintSegment(mask: Uint8Array, w: number, h: number, a: PenPoint, b: PenPoint, radius: number, value: number) {
  const span = (y: number, left: number, right: number) => {
    if (y < 0 || y >= h) return;
    const start = Math.max(0, Math.ceil(left - .5)), end = Math.min(w - 1, Math.floor(right - .5));
    if (start <= end) mask.fill(value, y * w + start, y * w + end + 1);
  };
  for (const p of [a, b]) for (let y = Math.max(0, Math.ceil(p.y - radius - .5)); y < Math.min(h, p.y + radius); y++) {
    const dx = Math.sqrt(Math.max(0, radius * radius - (y + .5 - p.y) ** 2));
    span(y, p.x - dx, p.x + dx);
  }
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!length) return;
  const nx = -(b.y - a.y) / length * radius, ny = (b.x - a.x) / length * radius;
  const corners = [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
  for (let y = Math.max(0, Math.ceil(Math.min(...corners.map((p) => p.y)) - .5)); y < Math.min(h, Math.max(...corners.map((p) => p.y))); y++) {
    const xs: number[] = [];
    for (let i = 0; i < 4; i++) {
      const p = corners[i], q = corners[(i + 1) % 4], cy = y + .5;
      if ((p.y > cy) !== (q.y > cy)) xs.push(p.x + (cy - p.y) / (q.y - p.y) * (q.x - p.x));
    }
    if (xs.length) span(y, Math.min(...xs), Math.max(...xs));
  }
}

/** 閉じた点列を偶奇規則でマスクへ戻す。穴への往復の橋は面積を持たない。 */
function polygonMask(points: PenPoint[], w: number, h: number) {
  const mask = new Uint8Array(w * h);
  const minY = Math.max(0, Math.floor(points.reduce((min, p) => Math.min(min, p.y), 1) * h));
  const maxY = Math.min(h, Math.ceil(points.reduce((max, p) => Math.max(max, p.y), 0) * h));
  for (let y = minY; y < maxY; y++) {
    const cy = (y + .5) / h, xs: number[] = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j], b = points[i];
      if ((a.y > cy) !== (b.y > cy)) xs.push((a.x + (cy - a.y) / (b.y - a.y) * (b.x - a.x)) * w);
    }
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i += 2) {
      const start = Math.max(0, Math.ceil(xs[i - 1] - .5)), end = Math.min(w, Math.ceil(xs[i] - .5));
      if (end > start) mask.fill(1, y * w + start, y * w + end);
    }
  }
  return mask;
}

/** セルの輪郭だけを点列へ変換。外周・穴の向きを保持し、SVGとPDFで同じ面を描く。 */
function traceMask(mask: Uint8Array, w: number, h: number): PenPoint[] {
  const edges = new Map<number, number[]>(), stride = w + 1;
  let edgeCount = 0;
  const edge = (x: number, y: number, direction: number) => {
    const key = y * stride + x;
    const list = edges.get(key) ?? []; list.push(direction); edges.set(key, list);
    if (++edgeCount > 100_000) throw new Error("輪郭が複雑すぎます。範囲を小さくしてください。");
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (y === 0 || !mask[(y - 1) * w + x]) edge(x, y, 0);
    if (x === w - 1 || !mask[y * w + x + 1]) edge(x + 1, y, 1);
    if (y === h - 1 || !mask[(y + 1) * w + x]) edge(x + 1, y + 1, 2);
    if (x === 0 || !mask[y * w + x - 1]) edge(x, y + 1, 3);
  }
  const loops: PenPoint[][] = [], steps = [1, stride, -1, -stride];
  while (edges.size) {
    const start = edges.keys().next().value!;
    let key = start, direction = edges.get(start)![0];
    const loop: PenPoint[] = [];
    do {
      const available = edges.get(key)!;
      const next = [(direction + 1) % 4, direction, (direction + 3) % 4, (direction + 2) % 4].find((d) => available.includes(d))!;
      const point = { x: key % stride / w, y: Math.floor(key / stride) / h };
      if (next !== direction || !loop.length) loop.push(point);
      available.splice(available.indexOf(next), 1);
      if (!available.length) edges.delete(key);
      key += steps[next]; direction = next;
    } while (key !== start);
    loop.push(loop[0]); loops.push(loop);
  }
  if (!loops.length) return [];
  // 各閉曲線へ同じ橋を往復する1点列。奇偶・非零どちらの塗り規則でも穴を維持する。
  const [first, ...rest] = loops;
  const points = [...first];
  for (const loop of rest) points.push(...loop, first[0]);
  if (points.length > 100_000) throw new Error("輪郭が複雑すぎます。範囲を小さくしてください。");
  return points;
}

export function fillEnclosedRegion(strokes: PenStroke[], point: PenPoint, pageWidth: number, pageHeight: number, color: string): PenStroke {
  if (![pageWidth, pageHeight].every((n) => Number.isFinite(n) && n > 0)
    || ![point.x, point.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error("塗りつぶす位置を取得できませんでした。");
  const g = grid(pageWidth, pageHeight), w = g.width, h = g.height;
  const blocked = new Uint8Array(w * h);
  let segments = 0;
  for (const stroke of strokes) {
    if (stroke.kind === "marker" || stroke.kind === "fill") continue;
    for (let i = 0; i < stroke.points.length; i++) {
      if (++segments > 100_000) throw new Error("線が多すぎます。範囲を分けて塗りつぶしてください。");
      const a = stroke.points[Math.max(0, i - 1)], b = stroke.points[i];
      // 細線がセル間を抜けないよう最小半径だけ補う。
      paintSegment(blocked, w, h, { x: a.x * w, y: a.y * h }, { x: b.x * w, y: b.y * h }, Math.max(.8, stroke.width * g.scale / 2), 1);
    }
  }
  const sx = Math.min(w - 1, Math.floor(point.x * w)), sy = Math.min(h - 1, Math.floor(point.y * h)), seed = sy * w + sx;
  if (blocked[seed]) throw new Error("線の内側をタップしてください。");
  const filled = new Uint8Array(w * h), queue = new Uint32Array(w * h);
  let head = 0, tail = 1; queue[0] = seed; filled[seed] = 1;
  while (head < tail) {
    const index = queue[head++], x = index % w, y = Math.floor(index / w);
    if (x === 0 || x === w - 1 || y === 0 || y === h - 1) throw new Error("線で囲まれた内側をタップしてください。");
    for (const neighbor of [index - 1, index + 1, index - w, index + w]) {
      if (!blocked[neighbor] && !filled[neighbor]) { filled[neighbor] = 1; queue[tail++] = neighbor; }
    }
  }
  // 境界の下へ1セルだけ重ねて、輪郭と塗りの間の白い隙間を抑える。線は常に塗りの上へ描く。
  const expanded = filled.slice();
  for (let i = 0; i < tail; i++) {
    const index = queue[i];
    for (const neighbor of [index - 1, index + 1, index - w, index + w]) if (blocked[neighbor]) expanded[neighbor] = 1;
  }
  return { kind: "fill", width: 1, color, points: traceMask(expanded, w, h) };
}

export function eraseFilledRegion(stroke: PenStroke, from: PenPoint, to: PenPoint, pageWidth: number, pageHeight: number, radius: number): PenStroke | null {
  const bounds = stroke.points.reduce((box, p) => ({ left: Math.min(box.left, p.x), right: Math.max(box.right, p.x), top: Math.min(box.top, p.y), bottom: Math.max(box.bottom, p.y) }),
    { left: 1, right: 0, top: 1, bottom: 0 });
  if (Math.max(from.x, to.x) + radius / pageWidth < bounds.left || Math.min(from.x, to.x) - radius / pageWidth > bounds.right
    || Math.max(from.y, to.y) + radius / pageHeight < bounds.top || Math.min(from.y, to.y) - radius / pageHeight > bounds.bottom) return stroke;
  const g = grid(pageWidth, pageHeight), w = g.width, h = g.height;
  const mask = polygonMask(stroke.points, w, h);
  const before = mask.slice();
  paintSegment(mask, w, h, { x: from.x * w, y: from.y * h }, { x: to.x * w, y: to.y * h }, radius * g.scale, 0);
  if (mask.every((value, index) => value === before[index])) return stroke;
  const points = traceMask(mask, w, h);
  return points.length ? { ...stroke, points } : null;
}
