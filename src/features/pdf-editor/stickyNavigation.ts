export type StickyFocusRequest = { textId: string; request: number };

// SVGの実表示座標を使い、倍率を変えずPDFのスクロール領域だけを動かす。
export function revealStickyElement(element: Element) {
  const viewport = element.closest<HTMLElement>(".pdf-viewport");
  if (!viewport) return;
  const target = element.getBoundingClientRect();
  const frame = viewport.getBoundingClientRect();
  if (![target.x, target.y, target.width, target.height].every(Number.isFinite)
    || target.width <= 0 || target.height <= 0) return;
  const offset = (start: number, size: number, frameStart: number, available: number) =>
    start - frameStart - (size > available ? 12 : (available - size) / 2);
  viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth,
    viewport.scrollLeft + offset(target.left, target.width, frame.left + viewport.clientLeft, viewport.clientWidth)));
  viewport.scrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight,
    viewport.scrollTop + offset(target.top, target.height, frame.top + viewport.clientTop, viewport.clientHeight)));
  // PCでPDF領域自体が画面の下へ隠れている場合だけ、外側も見える位置へ戻す。
  viewport.scrollIntoView({ block: "nearest", inline: "nearest" });
}
