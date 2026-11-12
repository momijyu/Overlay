import { readStrokes } from "./strokeData";
import { readTextNotes } from "./textData";
import type { PenPoint, PenStroke, TextNote } from "./types";

export type AnnotationContent = { strokes: PenStroke[]; texts: TextNote[] };
export type AnnotationSelection = { strokes: number[]; texts: string[] };
export type SelectionBounds = { left: number; top: number; right: number; bottom: number };
export type TextBounds = (note: TextNote) => SelectionBounds;
export const ANNOTATION_CLIPBOARD_TYPE = "application/x-overlay-annotations+json";
export const MAX_SELECTION_BYTES = 2_000_000;
const EPS = 1e-9;
const cross = (a: PenPoint, b: PenPoint, c: PenPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function inside(point: PenPoint, polygon: PenPoint[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (Math.abs(cross(a, b, point)) < EPS && point.x >= Math.min(a.x, b.x) - EPS
      && point.x <= Math.max(a.x, b.x) + EPS && point.y >= Math.min(a.y, b.y) - EPS && point.y <= Math.max(a.y, b.y) + EPS) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

function enclosed(points: PenPoint[], polygon: PenPoint[]) {
  if (!points.length || !points.every((point) => inside(point, polygon))) return false;
  // 凹んだ輪郭をまたぐ長い線分は、両端が内側でも選択しない。
  return points.slice(1).every((b, index) => {
    const a = points[index];
    if (!inside({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, polygon)) return false;
    return polygon.every((d, i) => {
      const c = polygon[(i + polygon.length - 1) % polygon.length];
      return !(cross(a, b, c) * cross(a, b, d) < -EPS && cross(c, d, a) * cross(c, d, b) < -EPS);
    });
  });
}

export function selectAnnotations(content: AnnotationContent, polygon: PenPoint[], textBounds: TextBounds): AnnotationSelection {
  if (polygon.length < 3) return { strokes: [], texts: [] };
  return {
    strokes: content.strokes.flatMap((stroke, index) => enclosed(stroke.points, polygon) ? [index] : []),
    texts: content.texts.filter((note) => {
      const b = textBounds(note);
      const corners = [{ x: b.left, y: b.top }, { x: b.right, y: b.top }, { x: b.right, y: b.bottom }, { x: b.left, y: b.bottom }];
      return enclosed([...corners, corners[0]], polygon);
    }).map((note) => note.id),
  };
}

export function selectedContent(content: AnnotationContent, selection: AnnotationSelection): AnnotationContent {
  const strokes = new Set(selection.strokes), texts = new Set(selection.texts);
  return { strokes: content.strokes.filter((_, i) => strokes.has(i)), texts: content.texts.filter((note) => texts.has(note.id)) };
}

export function annotationBounds(content: AnnotationContent, textBounds: TextBounds, width: number, height: number): SelectionBounds | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const include = (b: SelectionBounds) => { left = Math.min(left, b.left); top = Math.min(top, b.top); right = Math.max(right, b.right); bottom = Math.max(bottom, b.bottom); };
  for (const stroke of content.strokes) for (const point of stroke.points) {
    const padding = stroke.kind === "fill" ? 0 : stroke.width / 2;
    include({ left: point.x - padding / width, right: point.x + padding / width,
      top: point.y - padding / height, bottom: point.y + padding / height });
  }
  for (const note of content.texts) include(textBounds(note));
  return Number.isFinite(left) ? { left, top, right, bottom } : null;
}

export function moveAnnotations(content: AnnotationContent, selection: AnnotationSelection, delta: PenPoint,
  textBounds: TextBounds, width: number, height: number): AnnotationContent {
  const bounds = annotationBounds(selectedContent(content, selection), textBounds, width, height);
  if (!bounds || bounds.right - bounds.left > 1 + EPS || bounds.bottom - bounds.top > 1 + EPS) return content;
  // もともと端にかかった線の描画半径は維持し、動かすことでさらに外へ出さない。
  const dx = Math.max(Math.min(0, -bounds.left), Math.min(Math.max(0, 1 - bounds.right), delta.x));
  const dy = Math.max(Math.min(0, -bounds.top), Math.min(Math.max(0, 1 - bounds.bottom), delta.y));
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return content;
  const strokes = new Set(selection.strokes), texts = new Set(selection.texts);
  return {
    strokes: content.strokes.map((stroke, i) => strokes.has(i) ? { ...stroke, points: stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : stroke),
    texts: content.texts.map((note) => texts.has(note.id) ? { ...note, x: note.x + dx, y: note.y + dy } : note),
  };
}

export type AnnotationClipboard = AnnotationContent & { format: "overlay-annotations"; version: 1; width: number; height: number };
export function encodeAnnotationClipboard(content: AnnotationContent, width: number, height: number) {
  const value = JSON.stringify({ format: "overlay-annotations", version: 1, width, height, ...content });
  decodeAnnotationClipboard(value);
  return value;
}

export function decodeAnnotationClipboard(value: string): AnnotationClipboard {
  if (value.length > MAX_SELECTION_BYTES || new TextEncoder().encode(value).length > MAX_SELECTION_BYTES) throw new Error("コピーできる量を超えています。範囲を小さくしてください。");
  const data = JSON.parse(value);
  if (!data || data.format !== "overlay-annotations" || data.version !== 1
    || !Number.isFinite(data.width) || !Number.isFinite(data.height) || data.width < 1 || data.height < 1 || data.width > 100_000 || data.height > 100_000
    || !Array.isArray(data.strokes) || !Array.isArray(data.texts) || data.strokes.length + data.texts.length > 1000
    || data.strokes.reduce((count: number, stroke: PenStroke) => count + (Array.isArray(stroke?.points) ? stroke.points.length : 100_001), 0) > 100_000) throw new Error("貼り付けるデータが不正です。");
  return { format: data.format, version: 1, width: data.width, height: data.height,
    strokes: readStrokes({ 1: data.strokes })[1], texts: readTextNotes({ 1: data.texts })[1] };
}

export function pasteAnnotations(content: AnnotationContent, copied: AnnotationClipboard, width: number, height: number,
  textBounds: TextBounds, newId: () => string = () => crypto.randomUUID()): { content: AnnotationContent; selection: AnnotationSelection } {
  // PDF単位の寸法・文字サイズを維持。別寸法のページには縮小せず、入らなければ中止する。
  const sx = copied.width / width, sy = copied.height / height;
  const added: AnnotationContent = {
    strokes: copied.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((p) => ({ x: p.x * sx, y: p.y * sy })) })),
    texts: copied.texts.map((note) => ({ ...note, id: newId(), x: note.x * sx, y: note.y * sy, width: note.width * sx,
      ...(note.height === undefined ? {} : { height: note.height * sy }) })),
  };
  const b = annotationBounds(added, textBounds, width, height);
  if (!b || b.right - b.left > 1 + EPS || b.bottom - b.top > 1 + EPS) throw new Error("このページに収まりません。コピー範囲を小さくしてください。");
  const dx = Math.max(-b.left, Math.min(16 / width, 1 - b.right));
  const dy = Math.max(-b.top, Math.min(16 / height, 1 - b.bottom));
  const shifted = {
    strokes: added.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) })),
    texts: added.texts.map((note) => ({ ...note, x: note.x + dx, y: note.y + dy })),
  };
  // 境界の丸め・既存形式の検証も、履歴へ渡す前に行う。
  const valid = decodeAnnotationClipboard(encodeAnnotationClipboard(shifted, width, height));
  return { content: { strokes: [...content.strokes, ...valid.strokes], texts: [...content.texts, ...valid.texts] },
    selection: { strokes: valid.strokes.map((_, i) => content.strokes.length + i), texts: valid.texts.map((note) => note.id) } };
}
