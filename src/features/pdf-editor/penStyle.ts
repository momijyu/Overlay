export const PEN_COLOR = "#111827";
export const DEFAULT_PEN_WIDTH = 2.5;
export const DEFAULT_ERASER_WIDTH = 16;
export const MARKER_COLOR = "#facc15";
export const DEFAULT_MARKER_WIDTH = 16;
export const MARKER_OPACITY = 0.35;
export const MARKER_WIDTH_OPTIONS = [
  { width: 8, label: "極細" },
  { width: 12, label: "細" },
  { width: DEFAULT_MARKER_WIDTH, label: "標準" },
  { width: 20, label: "太" },
  { width: 24, label: "極太" },
] as const;
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
