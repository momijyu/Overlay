import assert from "node:assert/strict";
import test from "node:test";
import { bindPageGestures, createPageInteraction } from "@/features/pdf-editor/pageGestures";
import { restorePageZoomAnchor } from "@/features/pdf-editor/pageZoom";

// 座標とイベント接続を代用する。OSのジェスチャーや実機のcaptureは再現しない。
function fixture(hand = false) {
  const listeners = new Map<string, EventListener>();
  const captures = new Set<number>();
  const win = new EventTarget();
  let zoom = 1;
  let enabled = true;
  let cancelled = 0;
  let transformed = 0;
  const interaction = createPageInteraction();
  interaction.cancellations.add(() => { cancelled++; });
  const viewport = {
    clientWidth: 400, clientHeight: 300, clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0,
    ownerDocument: { defaultView: win },
    getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect,
    setPointerCapture: (id: number) => { captures.add(id); },
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => { captures.delete(id); },
    addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const surface = { getBoundingClientRect: () => ({ left: -viewport.scrollLeft, top: -viewport.scrollTop,
    width: 400 * zoom, height: 600 * zoom }) as DOMRect };
  const cleanup = bindPageGestures(viewport as unknown as HTMLElement, {
    interaction, getSurface: () => surface as HTMLElement, getZoom: () => zoom,
    isEnabled: () => enabled, isHand: () => hand,
    onTransform: (next, anchor) => { zoom = next; transformed++; restorePageZoomAnchor(viewport, surface, anchor); },
  });
  function emit(name: string, id = 1, x = 100, y = 100, type = "touch", target: unknown = viewport) {
    const event = { pointerId: id, clientX: x, clientY: y, pointerType: type, button: 0, target,
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    listeners.get(name)?.(event as unknown as Event);
    return event;
  }
  return { emit, interaction, viewport, cleanup, captures, win, zoom: () => zoom,
    cancelled: () => cancelled, transformed: () => transformed, disable: () => { enabled = false; }, listeners };
}

test("一本指は編集へ渡し、二本目で途中編集を中断してPDFだけを拡縮・移動する", () => {
  const f = fixture();
  assert.equal(f.emit("pointerdown").stopped, false);
  assert.equal(f.cancelled(), 0);
  assert.equal(f.emit("pointerdown", 2, 200).stopped, true);
  assert.equal(f.cancelled(), 1);
  assert.equal(f.interaction.blocked, true);
  assert.deepEqual([...f.captures], [1, 2]);
  f.emit("pointermove", 2, 300);
  assert.equal(f.zoom(), 2);
  assert.equal(f.viewport.scrollLeft, 100);
  assert.equal(f.viewport.scrollTop, 100);
  f.cleanup();
});

test("一本だけ残った指は描画・移動へ戻さず、全て離してから新しい編集を許可する", () => {
  const f = fixture();
  f.emit("pointerdown"); f.emit("pointerdown", 2, 200);
  f.emit("pointerup", 2, 200);
  const before = f.transformed();
  assert.equal(f.emit("pointermove", 1, 50).stopped, true);
  assert.equal(f.transformed(), before);
  assert.equal(f.interaction.blocked, true);
  assert.equal(f.emit("pointerup").stopped, true);
  assert.equal(f.interaction.blocked, false);
  assert.equal(f.emit("pointerdown", 3).stopped, false);
  f.cleanup();
});

test("二本指の距離は斜め方向も使い、倍率の上下限と重なった指を安全に扱う", () => {
  const f = fixture();
  f.emit("pointerdown", 1, 100, 100); f.emit("pointerdown", 2, 200, 200);
  f.emit("pointermove", 2, 150, 150);
  assert.equal(f.zoom(), 0.5);
  f.emit("pointermove", 2, 1000, 1000);
  assert.equal(f.zoom(), 2);
  f.cleanup();
  const same = fixture();
  same.emit("pointerdown"); same.emit("pointerdown", 2);
  same.emit("pointermove", 2, 200);
  assert.equal(same.zoom(), 1);
  same.cleanup();
});

test("三本目の追加・解除で倍率が飛ばず、残った二本で続けられる", () => {
  const f = fixture();
  f.emit("pointerdown"); f.emit("pointerdown", 2, 200);
  f.emit("pointermove", 2, 250);
  assert.equal(f.zoom(), 1.5);
  f.emit("pointerdown", 3, 300);
  f.emit("pointerup", 1);
  assert.equal(f.zoom(), 1.5);
  f.emit("pointermove", 3, 310);
  assert.ok(f.zoom() > 1.5);
  f.cleanup();
});

test("移動・閲覧では一本指・マウスのドラッグでも書かずに移動する", () => {
  for (const type of ["touch", "mouse", "pen"]) {
    const f = fixture(true);
    assert.equal(f.emit("pointerdown", 1, 100, 100, type).stopped, true);
    f.emit("pointermove", 1, 40, 50, type);
    assert.equal(f.zoom(), 1);
    assert.equal(f.viewport.scrollLeft, 60);
    assert.equal(f.viewport.scrollTop, 50);
    f.emit("pointerup", 1, 40, 50, type);
    assert.equal(f.interaction.blocked, false);
    f.cleanup();
  }
});

test("cancel・親capture解除・フォーカス喪失・破棄では未確定操作を保存せずリセットする", () => {
  for (const end of ["pointercancel", "lostpointercapture"]) {
    const f = fixture();
    f.emit("pointerdown"); f.emit("pointerdown", 2, 200);
    // 子から親へのcapture移動は、指が離れたとは扱わない。
    f.emit("lostpointercapture", 1, 100, 100, "touch", {});
    f.emit(end, 1); assert.equal(f.interaction.blocked, true);
    f.emit(end, 2);
    if (end === "lostpointercapture") {
      assert.equal(f.interaction.blocked, true);
      f.win.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 1 }));
      f.win.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 2 }));
    }
    assert.equal(f.interaction.blocked, false);
    f.cleanup();
  }
  const f = fixture();
  f.emit("pointerdown"); f.emit("pointerdown", 2, 200);
  f.win.dispatchEvent(new Event("blur"));
  assert.equal(f.interaction.blocked, false);
  assert.equal(f.captures.size, 0);
  f.cleanup();
  assert.equal(f.listeners.size, 0);
});

test("操作不可・文章入力欄はジェスチャーへ奪わない", () => {
  const f = fixture();
  f.disable();
  f.emit("pointerdown"); f.emit("pointerdown", 2, 200);
  assert.equal(f.interaction.blocked, false);
  f.cleanup();
  const editor = fixture(true);
  assert.equal(editor.emit("pointerdown", 1, 100, 100, "touch", { closest: () => ({}) }).stopped, false);
  assert.equal(editor.cancelled(), 0);
  editor.cleanup();
});

test("回転・リサイズでは途中編集を中断し、残った指を全て離すまで再開しない", () => {
  for (const name of ["resize", "orientationchange"]) {
    const f = fixture();
    f.emit("pointerdown", 1);
    f.emit("pointerdown", 2, 200);
    const before = f.transformed();
    f.win.dispatchEvent(new Event(name));
    assert.equal(f.cancelled(), 2);
    assert.equal(f.interaction.blocked, true);
    f.emit("pointermove", 1, 20);
    f.emit("pointerdown", 3, 300);
    f.emit("pointerup", 1);
    f.emit("pointermove", 3, 350);
    assert.equal(f.transformed(), before);
    f.emit("pointerup", 2);
    assert.equal(f.interaction.blocked, true);
    f.emit("pointerup", 3);
    assert.equal(f.interaction.blocked, false);
    f.cleanup();
    const cancelled = f.cancelled();
    f.win.dispatchEvent(new Event(name));
    assert.equal(f.cancelled(), cancelled);
  }
});
