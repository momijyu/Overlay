import { readNoteDrag, type NoteDragItem } from "./noteDrag";

export const NOTE_LONG_PRESS_MS = 600;
const SCROLL_SLOP = 10;
type Point = { x: number; y: number };
type TouchDragCallbacks = {
  onStart: (item: NoteDragItem, point: Point) => void;
  onMove: (point: Point) => void;
  onDrop: (point: Point) => void;
  onCancel: () => void;
};

// 長押し前の移動はスクロール、長押し後の移動だけドラッグにする。
export function createNotebookTouchDrag(callbacks: TouchDragCallbacks) {
  let pending: { id: number; point: Point; item: NoteDragItem } | null = null;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let suppressClickUntil = 0;
  function cancel() {
    clearTimeout(timer);
    if (active) {
      suppressClickUntil = Date.now() + 800;
      callbacks.onCancel();
    }
    pending = null;
    active = false;
  }
  return {
    start(id: number, point: Point, item: NoteDragItem, count: number) {
      cancel();
      if (count !== 1) return;
      pending = { id, point, item };
      timer = setTimeout(() => {
        if (!pending) return;
        active = true;
        callbacks.onStart(pending.item, pending.point);
      }, NOTE_LONG_PRESS_MS);
    },
    move(id: number, point: Point, count: number): boolean {
      if (!pending) return false;
      if (count !== 1 || id !== pending.id) { cancel(); return false; }
      if (!active) {
        if (Math.hypot(point.x - pending.point.x, point.y - pending.point.y) > SCROLL_SLOP) cancel();
        return false;
      }
      callbacks.onMove(point);
      return true;
    },
    end(id: number, point: Point): boolean {
      if (!pending || id !== pending.id) return false;
      const wasActive = active;
      clearTimeout(timer);
      pending = null;
      active = false;
      if (wasActive) {
        suppressClickUntil = Date.now() + 800;
        callbacks.onDrop(point);
      }
      return wasActive;
    },
    cancel,
    tracking: () => pending !== null,
    suppressClick: () => Date.now() < suppressClickUntil,
  };
}

// Reactのtouchmoveはpassiveになり得るため、長押し後だけ止められるnative listenerを使う。
export function attachNotebookTouchDrag(root: HTMLElement, callbacks: TouchDragCallbacks): () => void {
  const gesture = createNotebookTouchDrag(callbacks);
  const point = (touch: Touch): Point => ({ x: touch.clientX, y: touch.clientY });
  function start(event: TouchEvent) {
    if (event.touches.length !== 1) { gesture.cancel(); return; }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, select, textarea")) return;
    const row = target?.closest<HTMLElement>("[data-notebook-item]");
    const item = row && readNoteDrag(row.dataset.notebookItem ?? "");
    if (item) gesture.start(event.touches[0].identifier, point(event.touches[0]), item, event.touches.length);
  }
  function move(event: TouchEvent) {
    const touch = event.touches[0];
    if (touch && gesture.move(touch.identifier, point(touch), event.touches.length) && event.cancelable) event.preventDefault();
  }
  function end(event: TouchEvent) {
    if (event.touches.length) { gesture.cancel(); return; }
    const touch = event.changedTouches[0];
    if (touch && gesture.end(touch.identifier, point(touch)) && event.cancelable) event.preventDefault();
  }
  function click(event: MouseEvent) {
    if (gesture.suppressClick()) { event.preventDefault(); event.stopPropagation(); }
  }
  function context(event: Event) {
    if (event.target instanceof Element && event.target.closest("[data-notebook-item]")) event.preventDefault();
  }
  function additionalTouch(event: TouchEvent) {
    if (event.touches.length > 1) gesture.cancel();
  }
  function nativeDrag(event: DragEvent) {
    if (gesture.tracking()) { event.preventDefault(); event.stopPropagation(); }
  }
  root.addEventListener("touchstart", start, { passive: true });
  window.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("touchend", end, { passive: false });
  window.addEventListener("touchcancel", gesture.cancel);
  window.addEventListener("touchstart", additionalTouch, { passive: true });
  window.addEventListener("blur", gesture.cancel);
  root.addEventListener("click", click, true);
  root.addEventListener("contextmenu", context);
  root.addEventListener("dragstart", nativeDrag);
  root.addEventListener("dragend", nativeDrag);
  return () => {
    gesture.cancel();
    root.removeEventListener("touchstart", start);
    window.removeEventListener("touchmove", move);
    window.removeEventListener("touchend", end);
    window.removeEventListener("touchcancel", gesture.cancel);
    window.removeEventListener("touchstart", additionalTouch);
    window.removeEventListener("blur", gesture.cancel);
    root.removeEventListener("click", click, true);
    root.removeEventListener("contextmenu", context);
    root.removeEventListener("dragstart", nativeDrag);
    root.removeEventListener("dragend", nativeDrag);
  };
}

export function notebookDropAt(root: HTMLElement, x: number, y: number): string | null | undefined {
  const hit = root.ownerDocument.elementFromPoint(x, y);
  const target = hit?.closest<HTMLElement>("[data-notebook-drop]");
  if (!target || !root.contains(target)) return undefined;
  return target.dataset.notebookDrop === "root" ? null : target.dataset.notebookDrop;
}
