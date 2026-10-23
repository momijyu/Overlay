export const MIN_PAGE_ZOOM = 0.5;
export const MAX_PAGE_ZOOM = 2;

export function clampPageZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  // 細かいピンチ入力を1%単位で切り捨てない。スライダーだけを1%刻みにする。
  return Math.round(Math.max(MIN_PAGE_ZOOM, Math.min(MAX_PAGE_ZOOM, value)) * 10000) / 10000;
}

export function wheelPageZoom(current: number, delta: number, mode: number, pageHeight: number): number {
  if (!Number.isFinite(delta)) return clampPageZoom(current);
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? pageHeight : 1);
  return clampPageZoom(current * Math.exp(-Math.max(-100, Math.min(100, pixels)) * 0.005));
}

type ZoomSurface = Pick<HTMLElement, "getBoundingClientRect">;
type ZoomViewport = ZoomSurface & Pick<HTMLElement, "clientWidth" | "clientHeight" | "clientLeft" | "clientTop" | "scrollLeft" | "scrollTop">;
export type PageZoomAnchor = { x: number; y: number; clientX: number; clientY: number };

// 保存座標ではなく、現在画面上に見えているPDFに対する位置を記録する。
export function capturePageZoomAnchor(viewport: ZoomViewport, surface: ZoomSurface,
  pointer?: { clientX: number; clientY: number }): PageZoomAnchor | null {
  const bounds = surface.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const outer = viewport.getBoundingClientRect();
  const clientX = pointer?.clientX ?? outer.left + viewport.clientLeft + viewport.clientWidth / 2;
  const clientY = pointer?.clientY ?? outer.top + viewport.clientTop + viewport.clientHeight / 2;
  return {
    x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)),
    clientX, clientY,
  };
}

export function restorePageZoomAnchor(viewport: ZoomViewport, surface: ZoomSurface, anchor: PageZoomAnchor) {
  const bounds = surface.getBoundingClientRect();
  // スクロール可能な範囲を超える分はブラウザ側で丸められる。
  viewport.scrollLeft += bounds.left + bounds.width * anchor.x - anchor.clientX;
  viewport.scrollTop += bounds.top + bounds.height * anchor.y - anchor.clientY;
}

export function capturePageResizeAnchor(viewport: ZoomViewport, previous: PageZoomAnchor | null): PageZoomAnchor | null {
  if (!previous) return null;
  const outer = viewport.getBoundingClientRect();
  // 回転後はブラウザによる中央寄せ・スクロールの丸めが済んでいるため、変更前に記録したPDF座標を使う。
  return { ...previous,
    clientX: outer.left + viewport.clientLeft + viewport.clientWidth / 2,
    clientY: outer.top + viewport.clientTop + viewport.clientHeight / 2,
  };
}

// PDF領域の修飾キー付きホイールだけを扱う。Chromeのトラックパッドの
// ピンチもctrlKey付きのwheelとして届く。通常のスクロールには触れない。
export function bindPageZoomWheel(viewport: HTMLElement, options: {
  getZoom: () => number;
  isEnabled: () => boolean;
  onZoom: (zoom: number, event: WheelEvent) => void;
}) {
  const handleWheel = (event: WheelEvent) => {
    if (!(event.ctrlKey || event.metaKey) || !options.isEnabled() || !event.cancelable) return;
    event.preventDefault();
    const current = options.getZoom();
    const next = wheelPageZoom(current, event.deltaY, event.deltaMode, viewport.clientHeight);
    if (next !== current) options.onZoom(next, event);
  };
  viewport.addEventListener("wheel", handleWheel, { passive: false });
  return () => viewport.removeEventListener("wheel", handleWheel);
}
