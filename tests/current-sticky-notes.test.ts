import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import * as React from "react";
import type { StickyPageLink } from "@/features/pdf-editor/types";

let open = false;
let focused = 0;
let refs: { current: unknown }[] = [];
let cursor = 0;
let cleanup: (() => void) | undefined;
mock.module("react", { exports: { ...React,
  useState: () => [open, (next: boolean | ((previous: boolean) => boolean)) => { open = typeof next === "function" ? next(open) : next; }],
  useRef: (initial: unknown) => {
    const index = cursor++;
    return refs[index] ??= { current: index === 0 ? { focus: () => focused++ } : initial };
  },
  useEffect: (effect: () => (() => void)) => { cleanup ??= effect(); },
} });
const { CurrentStickyNotes } = await import("@/features/pdf-editor/components/CurrentStickyNotes");
beforeEach(() => { open = false; focused = 0; refs = []; cursor = 0; cleanup = undefined; });
afterEach(() => { cleanup?.(); mock.timers.reset(); });
function all(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...(child.props.inert ? [] : all(child.props.children as React.ReactNode))] : []);
}
const entries: StickyPageLink[] = [{ pageId: 5, pageNumber: 2, textId: "s1", label: "試験前に確認" }];
function fixture(disabled = false, notes = entries) {
  const jumps: unknown[][] = [];
  const render = () => {
    cursor = 0;
    return CurrentStickyNotes({ entries: notes, currentPageId: 5, disabled, onNavigate: (...args) => jumps.push(args) });
  };
  const buttons = () => all(render()).filter((child) => child.type === "button");
  const edgeEnter = (event: React.PointerEvent<HTMLElement>) => {
    (all(render()).find(child => child.props.className === "current-sticky-edge")!.props.onPointerEnter as (event: React.PointerEvent<HTMLElement>) => void)(event);
  };
  return { render, buttons, jumps, edgeEnter, toggle: () => (buttons()[0].props.onClick as () => void)() };
}

test("ノートメニューとは別の付箋入口を開閉し、ページ番号と本文だけを表示する", () => {
  const f = fixture();
  assert.equal(f.buttons().length, 1); assert.equal(f.buttons()[0].props["aria-expanded"], false);
  f.toggle();
  assert.equal(f.buttons()[0].props["aria-expanded"], true);
  const row = f.buttons().find((child) => child.props.title === "試験前に確認")!;
  assert.equal(row.props["aria-current"], "page");
  assert.ok(all(row).some((child) => child.props.children === "試験前に確認"));
  assert.ok(all(row).some((child) => Array.isArray(child.props.children) && child.props.children[0] === 2));
  (f.buttons().find((child) => child.props["aria-label"] === "付箋一覧を閉じる")!.props.onClick as () => void)();
  assert.equal(open, false); assert.equal(focused, 1);
});

function withPointerDevice(hover: boolean, run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: hover }) } });
  try { run(); } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
}
const pointer = (pointerType = "mouse") => ({ pointerType }) as React.PointerEvent<HTMLElement>;

test("右端のマウス接近で開き、一覧へ戻ると閉じ待ちを取り消し、離れるとフォーカスを奪わず閉じる", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  withPointerDevice(true, () => {
    const f = fixture();
    f.edgeEnter(pointer()); assert.equal(open, true);
    f.render().props.onPointerLeave(pointer());
    mock.timers.tick(199); assert.equal(open, true);
    f.edgeEnter(pointer());
    mock.timers.tick(201); assert.equal(open, true);
    f.render().props.onPointerLeave(pointer());
    mock.timers.tick(200); assert.equal(open, false); assert.equal(focused, 0);
  });
});

test("指・ペン・ホバー非対応端末では自動表示せず、ボタンで開ける", () => {
  withPointerDevice(true, () => {
    const f = fixture();
    f.edgeEnter(pointer("touch")); assert.equal(open, false);
    f.edgeEnter(pointer("pen")); assert.equal(open, false);
  });
  withPointerDevice(false, () => {
    const f = fixture(); f.edgeEnter(pointer()); assert.equal(open, false);
    f.toggle(); assert.equal(open, true);
  });
});

test("クリックで開いた一覧はマウスが離れても開いたまま操作できる", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); f.toggle(); f.render().props.onPointerLeave(pointer());
  mock.timers.tick(300); assert.equal(open, true);
});

test("キーボードで一覧へ入ると自動閉じを取り消す", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  withPointerDevice(true, () => {
    const f = fixture(); f.edgeEnter(pointer()); f.render().props.onPointerLeave(pointer());
    f.render().props.onFocusCapture({ target: { matches: () => true } } as unknown as React.FocusEvent<HTMLElement>);
    mock.timers.tick(300); assert.equal(open, true);
  });
});

test("画面を破棄した後に閉じ待ちの状態更新を実行しない", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  withPointerDevice(true, () => {
    const f = fixture(); f.edgeEnter(pointer()); f.render().props.onPointerLeave(pointer());
    cleanup?.(); mock.timers.tick(300); assert.equal(open, true);
  });
});

test("タッチ・狭幅では選択後に閉じ、広いPCでは一覧を残して再選択できる", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    for (const wide of [false, true]) {
      Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: wide }) } });
      open = true; const f = fixture();
      (f.buttons().find((child) => child.props.title)!.props.onClick as () => void)();
      assert.deepEqual(f.jumps, [[5, "s1"]]); assert.equal(open, wide);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("処理中は入口を開けるが、付箋移動は実行しない", () => {
  const f = fixture(true); f.toggle();
  const row = f.buttons().find((child) => child.props.title)!;
  assert.equal(row.props.disabled, true); (row.props.onClick as () => void)();
  assert.deepEqual(f.jumps, []);
});

test("空の一覧は短い案内を表示し、一覧内のEscapeで閉じて入口へ戻す", () => {
  const f = fixture(false, []); f.toggle();
  assert.ok(all(f.render()).some((child) => child.props.children === "付箋はありません。"));
  let stopped = false;
  f.render().props.onKeyDown({ key: "Escape", stopPropagation: () => { stopped = true; } } as React.KeyboardEvent<HTMLElement>);
  assert.equal(open, false); assert.equal(stopped, true); assert.equal(focused, 1);
});


test("右端以外への接近では開かず、閉じた一覧は操作・読み上げの対象にしない", () => {
  const f = fixture();
  f.render().props.onPointerEnter(pointer()); assert.equal(open, false);
  const panel = all(f.render()).find(child => child.props.id === "current-sticky-list")!;
  assert.equal(panel.props.inert, true); assert.equal(panel.props["aria-hidden"], true);
  f.toggle();
  const visible = all(f.render()).find(child => child.props.id === "current-sticky-list")!;
  assert.equal(visible.props.inert, false); assert.equal(visible.props["aria-hidden"], false);
});

test("付箋一覧の外側をタップすると移動せず閉じ、フォーカスを奪わない", () => {
  const f = fixture(); f.toggle();
  const backdrop = f.buttons().find(child => child.props.className === "current-sticky-backdrop")!;
  assert.equal(backdrop.props.tabIndex, -1);
  (backdrop.props.onClick as () => void)();
  assert.equal(open, false); assert.equal(focused, 0); assert.deepEqual(f.jumps, []);
  assert.ok(!f.buttons().some(child => child.props.className === "current-sticky-backdrop"));
});
