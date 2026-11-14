import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import * as React from "react";
import { imageFixture, testPng } from "./image-fixture";
import type { NoteImages } from "@/features/pdf-editor/types";
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
const { ImageLayer } = await import("@/features/pdf-editor/components/ImageLayer");
const { ImageCropDialog } = await import("@/features/pdf-editor/components/ImageCropDialog");
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
function fixture(images: NoteImages) {
  const changes: NoteImages[] = [], interaction = createPageInteraction();
  const props: React.ComponentProps<typeof ImageLayer> = { scope: {}, images, pageId: 1, width: 200, height: 200, scale: 2,
    active: true, disabled: false, controls: {} as HTMLDivElement, interaction, onChange: (value) => changes.push(value) };
  function render() {
    stateIndex = refIndex = effectIndex = memoIndex = 0; effects = [];
    const tree = ImageLayer(props);
    refs[0].current = { setPointerCapture() {} };
    for (const callback of effects) callback();
    return tree;
  }
  function surface() { return find(render(), (e) => e.type === "svg")!.props as React.ComponentProps<"svg">; }
  function down(resize = false) {
    const target = find(render(), (e) => resize ? e.type === "rect" && !!(e.props as React.ComponentProps<"rect">).onPointerDown
      : e.type === "g" && !!(e.props as React.ComponentProps<"g">).onPointerDown)!;
    (target.props as React.ComponentProps<"g">).onPointerDown!(pointer(0, 0) as React.PointerEvent<SVGGElement>);
  }
  function button(label: string) {
    return find(render(), (e) => e.type === "button" && (e.props as React.ComponentProps<"button">).children === label)!.props as React.ComponentProps<"button">;
  }
  return { props, render, surface, down, button, changes, interaction };
}
function pointer(x: number, y: number) {
  return { pointerId: 1, clientX: x, clientY: y, button: 0, preventDefault() {} } as React.PointerEvent<SVGSVGElement>;
}

test("画像の移動は倍率を補正し、ポインターを離すまで保存せず、中断・二本指操作は破棄する", async () => {
  const f = fixture(await imageFixture()); f.down();
  f.surface().onPointerMove!(pointer(40, 80)); assert.equal(f.changes.length, 0);
  f.surface().onPointerUp!(pointer(40, 80)); assert.equal(f.changes.length, 1);
  assert.equal(f.changes[0].byPage[1][0].x, .2);
  assert.ok(Math.abs(f.changes[0].byPage[1][0].y - .3) < 1e-9);
  f.down(); f.surface().onPointerMove!(pointer(80, 80)); f.surface().onPointerCancel!(pointer(80, 80));
  assert.equal(f.changes.length, 1);
  f.down(); f.surface().onPointerMove!(pointer(80, 80));
  f.interaction.cancellations.forEach((cancel) => cancel());
  f.surface().onPointerUp!(pointer(80, 80)); assert.equal(f.changes.length, 1);
});

test("画像の縦横比を保つサイズ変更・重なり順・削除・無効時の操作を接続する", async () => {
  const images = await imageFixture();
  images.byPage[1].push({ ...images.byPage[1][0], id: "second" });
  const f = fixture(images); f.down(); f.down(true);
  f.surface().onPointerMove!(pointer(80, 40)); f.surface().onPointerUp!(pointer(80, 40));
  const resized = f.changes.at(-1)!.byPage[1][0]; assert.equal(resized.width, resized.height);
  f.button("前へ").onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.equal(f.changes.at(-1)!.byPage[1][1].id, images.byPage[1][0].id);
  f.button("画像削除").onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.equal(f.changes.at(-1)!.byPage[1].length, 1);
  f.props.disabled = true; assert.equal(f.button("画像を追加").disabled, true);
  f.down(); f.surface().onPointerMove!(pointer(80, 80)); f.surface().onPointerUp!(pointer(80, 80));
  assert.equal(f.changes.length, 3);
});

test("画像の移動中に道具・倍率・保存内容が変わった場合は、途中の移動を保存しない", async () => {
  const images = await imageFixture();
  const f = fixture(images);
  for (const change of [
    () => { f.props.active = false; },
    () => { f.props.scale = 3; },
    () => { f.props.disabled = true; },
    () => { f.props.images = { ...images, byPage: { 1: [{ ...images.byPage[1][0], x: .5 }] } }; },
  ]) {
    f.props.active = true; f.props.disabled = false;
    f.down(); f.surface().onPointerMove!(pointer(40, 80));
    change(); f.render();
    f.surface().onPointerUp!(pointer(40, 80));
    assert.equal(f.changes.length, 0, "中断した操作で新しい状態を上書きしない");
  }
});

test("画像の読み込み中にページを切り替えた場合は、別ページへ追加しない", async () => {
  let complete!: (value: ImageBitmap) => void;
  mock.method(globalThis, "createImageBitmap", () => new Promise<ImageBitmap>((resolve) => { complete = resolve; }));
  const f = fixture(await imageFixture());
  const input = find(f.render(), (e) => e.type === "input")!.props as React.ComponentProps<"input">;
  input.onChange!({ target: { files: [new File([testPng()], "image.png", { type: "image/png" })] } } as unknown as React.ChangeEvent<HTMLInputElement>);
  while (!complete) await new Promise((resolve) => setImmediate(resolve));
  f.props.pageId = 2; f.render();
  let closed = false; complete({ width: 2, height: 2, close() { closed = true; } } as ImageBitmap);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(closed, true); assert.equal(f.changes.length, 0);
});

test("切り抜きの草稿は保存内容の更新や道具の切り替え後に持ち越さない", async () => {
  const images = await imageFixture(), f = fixture(images);
  f.down(); f.surface().onPointerUp!(pointer(0, 0));
  f.button("切り抜き").onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.ok(find(f.render(), (e) => e.type === ImageCropDialog));
  f.props.images = { ...images };
  assert.equal(find(f.render(), (e) => e.type === ImageCropDialog), undefined);
  f.button("切り抜き").onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.ok(find(f.render(), (e) => e.type === ImageCropDialog));
  f.props.active = false; f.render();
  f.props.active = true;
  assert.equal(find(f.render(), (e) => e.type === ImageCropDialog), undefined);
  assert.equal(f.changes.length, 0);
});

test("切り抜きは適用まで配置を確定せず、Escape・キャンセルで終了できる", () => {
  stateIndex = refIndex = effectIndex = 0; effects = [];
  let cancelled = 0, applied = 0;
  const changes: unknown[] = [];
  const tree = ImageCropDialog({ crop: { x: 0, y: 0, width: 1, height: 1 }, onCrop: (value) => changes.push(value),
    onClose: () => { cancelled++; }, onApply: () => { applied++; }, preview: null });
  const slider = find(tree, (e) => e.type === "input")!.props as React.ComponentProps<"input">;
  slider.onChange!({ target: { value: "25" } } as React.ChangeEvent<HTMLInputElement>);
  assert.deepEqual(changes, [{ x: .25, y: 0, width: .75, height: 1 }]); assert.equal(applied, 0);
  (find(tree, (e) => e.type === "dialog")!.props as React.ComponentProps<"dialog">).onCancel!({ preventDefault() {} } as React.SyntheticEvent<HTMLDialogElement>);
  assert.equal(cancelled, 1); assert.equal(applied, 0);
});
