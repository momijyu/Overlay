export const PEN_COLOR = "#111827";
export const DEFAULT_PEN_WIDTH = 2.5;
export const DEFAULT_ERASER_WIDTH = 16;
export const PEN_WIDTH_OPTIONS = [
  { width: 1, label: "極細" },
  { width: 1.5, label: "細" },
  { width: DEFAULT_PEN_WIDTH, label: "標準" },
  { width: 3.5, label: "太" },
  { width: 5, label: "極太" },
] as const;

export function isPenColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
