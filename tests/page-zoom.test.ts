import assert from "node:assert/strict";
import test from "node:test";
import {
  bindPageZoomWheel, capturePageZoomAnchor, capturePageResizeAnchor, clampPageZoom, restorePageZoomAnchor, wheelPageZoom,
} from "@/features/pdf-editor/pageZoom";

test("倍率を50〜200%に制限し、小さいピンチ入力も反映する", () => {
  assert.equal(clampPageZoom(0.1), 0.5);
  assert.equal(clampPageZoom(3), 2);
  assert.equal(clampPageZoom(NaN), 1);
  assert.ok(wheelPageZoom(1, -0.1, 0, 400) > 1);
  assert.ok(wheelPageZoom(1, 0.1, 0, 400) < 1);
  assert.equal(wheelPageZoom(1, NaN, 0, 400), 1);
  assert.equal(wheelPageZoom(2, -1000, 0, 400), 2);
  assert.equal(wheelPageZoom(0.5, 1000, 0, 400), 0.5);
});

test("ホイールのピクセル・行・ページ単位をそろえ、連続入力を積み重ねる", () => {
  assert.equal(wheelPageZoom(1, 16, 0, 400), wheelPageZoom(1, 1, 1, 400));
  assert.equal(wheelPageZoom(1, 40, 0, 400), wheelPageZoom(1, 0.1, 2, 400));
  let zoom = 1;
  for (let i = 0; i < 5; i++) zoom = wheelPageZoom(zoom, -5, 0, 400);
  assert.ok(zoom > wheelPageZoom(1, -5, 0, 400));
});

function geometry() {
  const viewport = {
    clientWidth: 400, clientHeight: 300, clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => ({ left: 10, top: 20 }) as DOMRect,
  };
  let bounds = { left: 30, top: 40, width: 600, height: 800 };
  const surface = { getBoundingClientRect: () => bounds as DOMRect };
  return { viewport, surface, resize: (next: typeof bounds) => { bounds = next; } };
}

test("ホイール位置のPDF座標を倍率変更後も同じ画面位置へ戻す", () => {
  const { viewport, surface, resize } = geometry();
  const anchor = capturePageZoomAnchor(viewport, surface, { clientX: 180, clientY: 240 })!;
  assert.equal(anchor.x, 0.25);
  assert.equal(anchor.y, 0.25);
  resize({ left: 30, top: 40, width: 1200, height: 1600 });
  restorePageZoomAnchor(viewport, surface, anchor);
  assert.equal(viewport.scrollLeft, 150);
  assert.equal(viewport.scrollTop, 200);
});

test("スライダーは表示領域の中心を基準にし、余白や未表示のPDFを安全に扱う", () => {
  const { viewport, surface, resize } = geometry();
  const center = capturePageZoomAnchor(viewport, surface)!;
  assert.equal(center.clientX, 210);
  assert.equal(center.clientY, 170);
  assert.equal(capturePageZoomAnchor(viewport, surface, { clientX: -100, clientY: 2000 })!.x, 0);
  assert.equal(capturePageZoomAnchor(viewport, surface, { clientX: -100, clientY: 2000 })!.y, 1);
  resize({ left: 0, top: 0, width: 0, height: 0 });
  assert.equal(capturePageZoomAnchor(viewport, surface), null);
});

test("回転では変更前の中心のPDF座標を、変更後の表示領域の中心へ合わせる", () => {
  const { viewport, surface, resize } = geometry();
  const before = capturePageZoomAnchor(viewport, surface)!;
  viewport.clientWidth = 800; viewport.clientHeight = 200;
  // 中央寄せやスクロールの丸めで既に位置が変わっても、変更前の記録を使用する。
  resize({ left: 110, top: 20, width: 600, height: 800 });
  viewport.scrollLeft = 0; viewport.scrollTop = 0;
  const after = capturePageResizeAnchor(viewport, before)!;
  assert.equal(after.x, before.x);
  assert.equal(after.y, before.y);
  assert.equal(after.clientX, 410);
  assert.equal(after.clientY, 120);
  assert.equal(capturePageResizeAnchor(viewport, null), null);
});

test("PDF領域のCtrl・Command・ピンチだけを処理し、通常スクロール・無効時と解除後は触らない", () => {
  const target = new EventTarget();
  let zoom = 1;
  let enabled = true;
  let passive: boolean | undefined;
  const viewport = {
    clientHeight: 400,
    addEventListener: (type: string, listener: EventListener, options: AddEventListenerOptions) => {
      passive = options.passive;
      target.addEventListener(type, listener, options);
    },
    removeEventListener: (type: string, listener: EventListener) => target.removeEventListener(type, listener),
  } as unknown as HTMLElement;
  const unbind = bindPageZoomWheel(viewport, {
    getZoom: () => zoom, isEnabled: () => enabled, onZoom: (next) => { zoom = next; },
  });
  assert.equal(passive, false);
  function wheel(modifiers = {}, cancelable = true) {
    const event = new Event("wheel", { cancelable });
    Object.assign(event, { deltaY: -10, deltaMode: 0, ctrlKey: false, metaKey: false, ...modifiers });
    target.dispatchEvent(event);
    return event;
  }
  assert.equal(wheel().defaultPrevented, false);
  assert.equal(zoom, 1);
  assert.equal(wheel({ ctrlKey: true }).defaultPrevented, true);
  const first = zoom;
  assert.equal(wheel({ metaKey: true }).defaultPrevented, true);
  assert.ok(zoom > first);
  zoom = 2;
  assert.equal(wheel({ ctrlKey: true }).defaultPrevented, true);
  assert.equal(zoom, 2);
  enabled = false;
  assert.equal(wheel({ ctrlKey: true }).defaultPrevented, false);
  enabled = true;
  assert.equal(wheel({ ctrlKey: true }, false).defaultPrevented, false);
  unbind();
  zoom = 1;
  assert.equal(wheel({ ctrlKey: true }).defaultPrevented, false);
  assert.equal(zoom, 1);
});
