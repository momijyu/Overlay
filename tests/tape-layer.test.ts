import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import * as React from "react";

import type { MaskTape } from "@/features/pdf-editor/types";
import { createPageInteraction } from "@/features/pdf-editor/pageGestures";

let states: unknown[] = [], refs: { current: unknown }[] = [];
let stateIndex = 0, refIndex = 0, effectIndex = 0;
let effects: (() => void)[] = [];
let slots: { deps?: unknown[]; cleanup?: () => void }[] = [];
let memoIndex = 0;
let memos: { deps: unknown[]; value: unknown }[] = [];
function effect(callback: () => void | (() => void), deps?: unknown[]) {
  const index = effectIndex++, previous = slots[index];
  if (deps && previous?.deps && deps.length === previous.deps.length && deps.every((dep, i) => Object.is(dep, previous.deps![i]))) return;
  effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() || undefined }; });
}
mock.module("react", { exports: { ...React,
  useState(initial: unknown) {
    const index = stateIndex++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (next: unknown) => { states[index] = next; }];
  },
  useRef(initial: unknown) { return refs[refIndex++] ??= { current: initial }; },
  useId: () => "image-test",
  useMemo(callback: () => unknown, deps: unknown[]) {
    const index = memoIndex++, previous = memos[index];
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) memos[index] = { deps, value: callback() };
    return memos[index].value;
  },
  useEffect: effect, useLayoutEffect: effect,
} });
mock.module("react-dom", { exports: { createPortal: (children: React.ReactNode) => children } });
const { TapeLayer } = await import("@/features/pdf-editor/components/TapeLayer");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
beforeEach(() => {
  states = []; refs = []; slots = []; effects = []; memos = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { body: {} } });
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, writable: true, value: () => {} });
});
afterEach(() => {
  slots.forEach((slot) => slot.cleanup?.());
  mock.restoreAll();
  for (const [name, descriptor] of [["window", originalWindow], ["document", originalDocument], ["createImageBitmap", originalBitmap]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  }
});
function find(node: React.ReactNode, predicate: (element: React.ReactElement) => boolean): React.ReactElement | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) continue;
    if (predicate(child)) return child;
    const result = find(child.props.children, predicate); if (result) return result;
  }
}
const tape = { id: "answer", x: .1, y: .2, width: .3, height: .05 };
function fixture(tapes: MaskTape[] = [tape]) {
  const changes: MaskTape[][] = [], interaction = createPageInteraction();
  const props: React.ComponentProps<typeof TapeLayer> = { scope: {}, tapes, width: 200, height: 200, scale: 2,
    active: true, revealable: false, disabled: false, interaction, controls: {} as HTMLDivElement, onChange: (value) => changes.push(value) };
  function render() {
    stateIndex = refIndex = effectIndex = memoIndex = 0; effects = [];
    const tree = TapeLayer(props);
    refs[0].current = { setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0 }; } };
    for (const callback of effects) callback();
    return tree;
  }
  function button(label: string) {
    return find(render(), (e) => e.type === "button" && ((e.props as React.ComponentProps<"button">)["aria-label"] === label ||
      (e.props as React.ComponentProps<"button">).children === label))!.props as React.ComponentProps<"button">;
  }
  function surface() { return find(render(), (e) => (e.props as React.ComponentProps<"div">)["aria-label"] === "目隠しテープレイヤー")!.props as React.ComponentProps<"div">; }
  return { props, changes, interaction, render, button, surface };
}
function pointer(x = 40, y = 80) {
  return { pointerId: 1, clientX: x, clientY: y, button: 0, preventDefault() {}, stopPropagation() {} } as React.PointerEvent<HTMLDivElement & HTMLButtonElement>;
}

test("タップ・手ツール・すべて隠すは表示だけ切り替え、保存や履歴へ渡さない", () => {
  const f = fixture();
  f.button("答えを表示").onPointerDown!(pointer()); f.surface().onPointerUp!(pointer());
  assert.equal(f.button("答えを隠す")["aria-pressed"], true);
  f.button("すべて隠す").onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.equal(f.button("答えを表示")["aria-pressed"], false);
  f.props.active = false; f.props.revealable = true;
  f.button("答えを表示").onClick!({ detail: 1 } as React.MouseEvent<HTMLButtonElement>);
  assert.equal(f.button("答えを隠す")["aria-pressed"], true);
  assert.equal(f.changes.length, 0);
});

test("配置・移動・リサイズは指を離してから1回だけ確定し、削除も操作できる", () => {
  const f = fixture([]);
  const surface = f.surface(), event = pointer(40, 80); event.target = event.currentTarget = {} as HTMLDivElement & HTMLButtonElement;
  surface.onPointerDown!(event);
  f.surface().onPointerMove!(pointer(160, 120));
  assert.equal(f.changes.length, 0);
  f.surface().onPointerUp!(pointer(160, 120));
  assert.equal(f.changes.length, 1);
  assert.deepEqual({ ...f.changes[0][0], id: "test" }, { id: "test", x: .1, y: .2, width: .30000000000000004, height: .09999999999999998, color: "#fb923c" });
  f.props.tapes = f.changes[0];
  f.button("答えを表示").onPointerDown!(pointer());
  f.surface().onPointerMove!(pointer(80, 120)); f.surface().onPointerUp!(pointer(80, 120));
  assert.equal(f.changes.length, 2);
  f.props.tapes = f.changes[1];
  f.button("テープのサイズ変更").onPointerDown!(pointer());
  f.surface().onPointerMove!(pointer(100, 140)); f.surface().onPointerUp!(pointer(100, 140));
  assert.equal(f.changes.length, 3);
  assert.ok(f.changes[2][0].width > f.changes[1][0].width);
  f.props.tapes = f.changes[2];
  f.button("テープ削除").onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.deepEqual(f.changes.at(-1), []);
});

for (const condition of ["tool", "zoom", "document", "data", "pinch", "cancel"] as const) {
  test(`${condition}で中断したドラッグを確定しない`, () => {
    const f = fixture();
    f.button("答えを表示").onPointerDown!(pointer());
    f.surface().onPointerMove!(pointer(120, 120));
    if (condition === "tool") f.props.active = false;
    if (condition === "zoom") f.props.scale = 1;
    if (condition === "document") f.props.scope = {};
    if (condition === "data") f.props.tapes = [{ ...tape, x: .2 }];
    if (condition === "pinch") { f.interaction.blocked = true; f.interaction.cancellations.forEach((cancel) => cancel()); }
    if (condition === "cancel") f.surface().onPointerCancel!(pointer());
    f.surface().onPointerUp!(pointer(120, 120));
    assert.equal(f.changes.length, 0);
  });
}

test("ノート切り替え・再読み込みでは答えを隠し、保存失敗は画面に表示する", () => {
  const f = fixture();
  f.button("答えを表示").onClick!({ detail: 0 } as React.MouseEvent<HTMLButtonElement>);
  f.props.scope = {};
  assert.equal(f.button("答えを表示")["aria-pressed"], false);
  f.props.onChange = () => { throw new Error("容量不足"); };
  f.button("テープを追加").onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.ok(find(f.render(), (e) => (e.props as React.ComponentProps<"span">).role === "alert"));
});

test("新規色の選択だけでは保存せず、選択中の旧テープは色変更を確定できる", () => {
  const f = fixture();
  function picker() {
    return find(f.render(), (e) => e.type === "input" && (e.props as React.ComponentProps<"input">).type === "color")!.props as React.ComponentProps<"input">;
  }
  function change(value: string) { picker().onChange!({ target: { value } } as React.ChangeEvent<HTMLInputElement>); }
  assert.equal(picker().value, "#fb923c");
  change("#008800");
  assert.equal(f.changes.length, 0);
  f.button("テープを追加").onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.equal(f.changes[0][1].color, "#008800");
  f.props.tapes = [tape];
  f.button("答えを表示").onPointerDown!(pointer()); f.surface().onPointerUp!(pointer());
  assert.equal(picker().value, "#fcd34d");
  change("#123456");
  assert.deepEqual(f.changes[1], [{ ...tape, color: "#123456" }]);
  f.props.disabled = true;
  change("#abcdef");
  assert.equal(f.changes.length, 2);
});
