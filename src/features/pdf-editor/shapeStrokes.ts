import type { PenPoint, PenStroke } from "./types";

export const SHAPE_OPTIONS = [
  { kind: "line", label: "直線" },
  { kind: "arrow", label: "矢印" },
  { kind: "rectangle", label: "四角" },
  { kind: "ellipse", label: "楕円" },
] as const;
export type ShapeKind = typeof SHAPE_OPTIONS[number]["kind"];

/** 図形をPDF座標の折れ線へ変換し、既存の保存・部分消去・投げ縄と共用する。 */
export function createShapeStroke(kind: ShapeKind, origin: PenPoint, end: PenPoint,
  pageWidth: number, pageHeight: number, width: number, color: string): PenStroke | null {
  if (![pageWidth, pageHeight, width].every((value) => Number.isFinite(value) && value > 0)
    || ![origin.x, origin.y, end.x, end.y].every(Number.isFinite)) return null;
  const marginX = Math.min(width / 2, pageWidth / 2);
  const marginY = Math.min(width / 2, pageHeight / 2);
  const clamp = (point: PenPoint): PenPoint => ({
    x: Math.max(marginX, Math.min(pageWidth - marginX, point.x)),
    y: Math.max(marginY, Math.min(pageHeight - marginY, point.y)),
  });
  const a = clamp({ x: origin.x * pageWidth, y: origin.y * pageHeight });
  const b = clamp({ x: end.x * pageWidth, y: end.y * pageHeight });
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  // タップや縦横がつぶれた箱を、見えない図形として保存しない。
  if (length < 2 || ((kind === "rectangle" || kind === "ellipse") && (Math.abs(dx) < 2 || Math.abs(dy) < 2))) return null;
  let points: PenPoint[];
  if (kind === "line") points = [a, b];
  else if (kind === "arrow") {
    const head = Math.min(length * 0.35, Math.max(10, width * 3));
    const ux = dx / length, uy = dy / length;
    points = [a, b, clamp({ x: b.x - head * ux - head * 0.5 * uy, y: b.y - head * uy + head * 0.5 * ux }), b,
      clamp({ x: b.x - head * ux + head * 0.5 * uy, y: b.y - head * uy - head * 0.5 * ux })];
  } else if (kind === "rectangle") points = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
  else {
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const rx = Math.abs(dx) / 2, ry = Math.abs(dy) / 2;
    points = Array.from({ length: 64 }, (_, index) => {
      const angle = index * Math.PI * 2 / 64;
      return { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) };
    });
    points.push(points[0]);
  }
  return { width, color, points: points.map((point) => ({ x: point.x / pageWidth, y: point.y / pageHeight })) };
}
