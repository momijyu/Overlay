type Bounds = { left: number; right: number; top: number; bottom: number };

// 画面座標で収めた後にPDF座標へ戻す。文字・付箋の保存位置は変更しない。
export function textEditorOptionsPosition(anchor: Bounds, width: number, height: number, bounds: Bounds, scale: number) {
  const padding = 8;
  const availableWidth = Math.max(0, bounds.right - bounds.left - padding * 2);
  const availableHeight = Math.max(0, bounds.bottom - bounds.top - padding * 2);
  const fittedWidth = Math.min(width, availableWidth);
  const fittedHeight = Math.min(height, availableHeight);
  const left = Math.max(bounds.left + padding, Math.min(anchor.left, bounds.right - padding - fittedWidth));
  const above = anchor.top - padding - fittedHeight;
  const top = Math.max(bounds.top + padding, Math.min(
    above >= bounds.top + padding ? above : anchor.bottom + padding,
    bounds.bottom - padding - fittedHeight,
  ));
  return { left: (left - anchor.left) / scale, top: (top - anchor.top) / scale,
    maxWidth: availableWidth, maxHeight: availableHeight };
}
