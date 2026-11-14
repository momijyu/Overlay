import type { MaskTape, PenPoint, TapesByPage } from "./types";
export const MAX_MASK_TAPES = 1000;
export const EMPTY_TAPES: MaskTape[] = [];
export function readMaskTapes(value: unknown): TapesByPage | undefined {
  if (value === undefined)
    return undefined;
  const invalid = (): never => { throw new Error("目隠しテープの保存形式が不正です。"); };
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid();
  const result: TapesByPage = {};
  let count = 0;
  for (const [page, items] of Object.entries(value as object)) {
    if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)) || !Array.isArray(items))
      invalid();
    count += items.length;
    if (count > MAX_MASK_TAPES)
      invalid();
    const ids = new Set<string>();
    result[Number(page)] = items.map((item: MaskTape): MaskTape => {
      if (!item || typeof item !== "object")
        invalid();
      const { id, x, y, width, height } = item;
      if (typeof id !== "string" || !id.trim() || id.length > 100 || ids.has(id)
        || ![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))
        || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.000001 || y + height > 1.000001)
        invalid();
      ids.add(id);
      return { id, x, y, width, height };
    });
  }
  return result;
}
export function tapeRectangle(start: PenPoint, end: PenPoint) {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const x = Math.min(clamp(start.x), clamp(end.x)), y = Math.min(clamp(start.y), clamp(end.y));
  return { x, y, width: Math.abs(clamp(end.x) - clamp(start.x)), height: Math.abs(clamp(end.y) - clamp(start.y)) };
}
export function moveTape(tape: MaskTape, dx: number, dy: number): MaskTape {
  return { ...tape, x: Math.max(0, Math.min(1 - tape.width, tape.x + dx)), y: Math.max(0, Math.min(1 - tape.height, tape.y + dy)) };
}
