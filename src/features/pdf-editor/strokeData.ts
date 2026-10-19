import type { PenStroke } from "./types";
import { isPenColor } from "./penStyle";

// 保存先にかかわらず、読み込むJSONの座標・太さ・任意の色を同じ条件で検証する。
export function readStrokes(value: unknown): Record<number, PenStroke[]> {
  const invalid = () => new Error("保存された書き込み情報を読み込めませんでした。");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const result: Record<number, PenStroke[]> = {};
  for (const [page, strokes] of Object.entries(value)) {
    if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)) || !Array.isArray(strokes)) throw invalid();
    result[Number(page)] = strokes.map((stroke: unknown) => {
      if (!stroke || typeof stroke !== "object" || !("width" in stroke) || !("points" in stroke)) throw invalid();
      const { width, points } = stroke;
      const color = "color" in stroke ? stroke.color : undefined;
      if (color !== undefined && !isPenColor(color)) throw invalid();
      if (typeof width !== "number" || !Number.isFinite(width) || width <= 0 || !Array.isArray(points) || points.length === 0) throw invalid();
      return {
        width,
        ...(color === undefined ? {} : { color }),
        points: points.map((point: unknown) => {
          if (!point || typeof point !== "object" || !("x" in point) || !("y" in point)) throw invalid();
          const { x, y } = point;
          if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)
            || x < 0 || x > 1 || y < 0 || y > 1) throw invalid();
          return { x, y };
        }),
      };
    });
  }
  return result;
}
