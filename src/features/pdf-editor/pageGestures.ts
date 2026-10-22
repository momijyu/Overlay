import { capturePageZoomAnchor, clampPageZoom, type PageZoomAnchor } from "./pageZoom";

// 親が二本指操作を検出した同じイベント内で、子の未確定操作を中断する。
// Reactの再描画を待たずにblockedを参照し、残った指での誤描画も防ぐ。
export type PageInteraction = { blocked: boolean; cancellations: Set<() => void> };
export function createPageInteraction(): PageInteraction {
  return { blocked: false, cancellations: new Set() };
}

type Point = { clientX: number; clientY: number };
type Gesture = { zoom: number; distance: number; pinch: boolean; anchor: PageZoomAnchor };

export function bindPageGestures(viewport: HTMLElement, options: {
  interaction: PageInteraction;
  getSurface: () => HTMLElement | null;
  getZoom: () => number;
  isEnabled: () => boolean;
  isHand: () => boolean;
  onTransform: (zoom: number, anchor: PageZoomAnchor) => void;
}) {
  const touches = new Map<number, Point>();
  let mouse: number | null = null;
  let gesture: Gesture | null = null;
  const { interaction } = options;
  function stop(event: PointerEvent) { event.preventDefault(); event.stopPropagation(); }
  function cancelEditing() {
    interaction.blocked = true;
    interaction.cancellations.forEach((cancel) => cancel());
  }
  function midpoint(): Point | null {
    const [a, b] = [...touches.values()];
    return b ? { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 } : a ?? null;
  }
  function distance() {
    const [a, b] = [...touches.values()];
    return b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
  }
  function begin(point: Point) {
    const surface = options.getSurface();
    const anchor = surface && capturePageZoomAnchor(viewport, surface, point);
    if (!anchor) return;
    cancelEditing();
    gesture = { zoom: options.getZoom(), distance: distance(), pinch: touches.size >= 2, anchor };
    for (const id of touches.keys()) {
      try { viewport.setPointerCapture(id); } catch { /* 既に終了したポインターは次のupで取り除く。 */ }
    }
  }
  function down(event: PointerEvent) {
    if (!options.isEnabled() || (event.target as Element | null)?.closest?.("textarea,input,button,select,[contenteditable],[data-text-editor]")) return;
    if (event.pointerType === "touch") {
      touches.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (touches.size >= 2 || options.isHand()) {
        const point = midpoint();
        if (point) begin(point);
        if (interaction.blocked) stop(event);
      } else if (interaction.blocked) stop(event);
    } else if (options.isHand() && event.button === 0 && mouse === null) {
      mouse = event.pointerId;
      begin(event);
      try { viewport.setPointerCapture(event.pointerId); } catch { /* 中断時は保存しない。 */ }
      stop(event);
    }
  }
  function move(event: PointerEvent) {
    if (touches.has(event.pointerId)) touches.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (!interaction.blocked) return;
    stop(event);
    if (!gesture || !options.isEnabled()) return;
    // ピンチ後は一本だけ残っても、描画にも片指移動にも戻さない。
    if (mouse !== event.pointerId && touches.size < 2 && gesture.pinch) return;
    const point = mouse === event.pointerId ? event : midpoint();
    if (!point) return;
    const zoom = gesture.distance > 0 ? clampPageZoom(gesture.zoom * distance() / gesture.distance) : gesture.zoom;
    options.onTransform(zoom, { ...gesture.anchor, clientX: point.clientX, clientY: point.clientY });
  }
  function up(event: PointerEvent) {
    if (!touches.has(event.pointerId) && mouse !== event.pointerId) return;
    touches.delete(event.pointerId);
    if (mouse === event.pointerId) mouse = null;
    if (interaction.blocked) stop(event);
    if (touches.size === 0 && mouse === null) {
      gesture = null;
      interaction.blocked = false;
    } else if (touches.size >= 2) {
      const point = midpoint();
      if (point) begin(point);
    }
  }
  function lost(event: PointerEvent) {
    // 子から親へcaptureを移しただけなら、指が離れたとは扱わない。
    if (event.target === viewport && (touches.has(event.pointerId) || mouse === event.pointerId)) {
      cancelEditing(); gesture = null;
    }
  }
  function reset() {
    cancelEditing();
    for (const id of [...touches.keys(), ...(mouse === null ? [] : [mouse])]) {
      try { if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id); } catch { /* 切断済み */ }
    }
    touches.clear(); mouse = null; gesture = null; interaction.blocked = false;
  }
  const events = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: up, lostpointercapture: lost };
  for (const [name, listener] of Object.entries(events)) viewport.addEventListener(name, listener as EventListener, { capture: true, passive: false });
  const ownerWindow = viewport.ownerDocument?.defaultView;
  ownerWindow?.addEventListener("blur", reset);
  // captureが途中で失われてPDF外で指を離した場合も、追跡を残さない。
  ownerWindow?.addEventListener("pointerup", up, true);
  ownerWindow?.addEventListener("pointercancel", up, true);
  return () => {
    for (const [name, listener] of Object.entries(events)) viewport.removeEventListener(name, listener as EventListener, true);
    ownerWindow?.removeEventListener("blur", reset);
    ownerWindow?.removeEventListener("pointerup", up, true);
    ownerWindow?.removeEventListener("pointercancel", up, true);
    reset();
  };
}
