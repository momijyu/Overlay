import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let effect: (() => void | (() => void)) | undefined;
mock.module("react", { exports: { ...React, useEffect(next: typeof effect) { effect = next; } } });
const { NotebookActionsMenu } = await import("@/features/pdf-editor/components/NotebookActionsMenu");
const inside = {};
let focused = 0;
const menu = { open: true, contains: (target: unknown) => target === inside,
  querySelector: () => ({ focus() { focused++; } }) };
const menuRef = { current: menu as unknown as HTMLDetailsElement };
beforeEach(() => { effect = undefined; focused = 0; menu.open = true; });
function render(visible = true) { return NotebookActionsMenu({ menuRef, visible, children: React.createElement("button", {}, "名前変更") }); }

test("操作の外側を押す・フォーカスを移すと閉じ、内部操作と終了後には反応しない", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document"), events = new EventTarget();
  Object.defineProperty(globalThis, "document", { configurable: true, value: events });
  render(); const cleanup = effect!();
  try {
    for (const type of ["pointerdown", "focusin"]) {
      menu.open = true;
      const event = new Event(type); Object.defineProperty(event, "target", { value: inside });
      events.dispatchEvent(event); assert.equal(menu.open, true);
      events.dispatchEvent(new Event(type)); assert.equal(menu.open, false);
    }
    cleanup?.(); menu.open = true;
    events.dispatchEvent(new Event("pointerdown")); assert.equal(menu.open, true);
    assert.equal(focused, 0, "外側操作でフォーカスを奪わない");
  } finally {
    cleanup?.();
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});

test("Escapeは操作だけを閉じてボタンへ戻し、閉じた後のEscapeは一覧へ渡す", () => {
  const node = render(); let prevented = 0, stopped = 0;
  const event = { key: "Escape", preventDefault() { prevented++; }, stopPropagation() { stopped++; } } as unknown as React.KeyboardEvent<HTMLDetailsElement>;
  node.props.onKeyDown(event);
  assert.equal(menu.open, false); assert.equal(focused, 1);
  assert.equal(prevented, 1); assert.equal(stopped, 1);
  node.props.onKeyDown(event);
  assert.equal(prevented, 1); assert.equal(stopped, 1);
});

test("一覧を隠すと操作メニューを閉じ、再表示に開いた状態を持ち越さない", () => {
  const node = render(false); effect!();
  assert.equal(menu.open, false); assert.equal(focused, 0);
  const html = renderToStaticMarkup(node);
  assert.match(html, /<summary class="btn btn-sm">操作<\/summary>/);
  assert.match(html, /名前変更/);
});
