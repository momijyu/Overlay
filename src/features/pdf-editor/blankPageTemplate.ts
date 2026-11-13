import type { BlankPageTemplate } from "./types";

export const BLANK_PAGE_TEMPLATES: readonly { value: BlankPageTemplate; label: string }[] = [
  { value: "plain", label: "無地" }, { value: "ruled", label: "罫線" }, { value: "grid", label: "方眼" },
];
export const TEMPLATE_LINE_COLOR = "#d6d9df";
export const TEMPLATE_LINE_WIDTH = 0.5;

// CanvasとPDFで同じ表示座標（PDFポイント）を使う。背景線は編集対象の線と分離する。
export function blankPageTemplateLines(template: BlankPageTemplate | undefined, width: number, height: number) {
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  if (!template || template === "plain") return lines;
  const margin = 24, spacing = template === "grid" ? 20 : 24;
  if (width <= margin * 2 || height <= margin * 2) return lines;
  if (template === "grid") {
    const columns = Math.floor((width - margin * 2) / spacing);
    const rows = Math.floor((height - margin * 2) / spacing);
    if (columns < 1 || rows < 1) return lines;
    // 完全なマスだけを中央に配置し、端数を左右・上下の余白へ等分する。
    const left = (width - columns * spacing) / 2, top = (height - rows * spacing) / 2;
    const right = left + columns * spacing, bottom = top + rows * spacing;
    for (let row = 0; row <= rows; row++) {
      const y = top + row * spacing;
      lines.push({ x1: left, y1: y, x2: right, y2: y });
    }
    for (let column = 0; column <= columns; column++) {
      const x = left + column * spacing;
      lines.push({ x1: x, y1: top, x2: x, y2: bottom });
    }
    return lines;
  }
  for (let y = margin; y <= height - margin; y += spacing) {
    lines.push({ x1: margin, y1: y, x2: width - margin, y2: y });
  }
  return lines;
}
