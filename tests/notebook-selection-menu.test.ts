import assert from "node:assert/strict";
import test, { mock } from "node:test";
import * as React from "react";

let effect: (() => void | (() => void)) | undefined;
const inside = {};
let focused = 0;
const element = { contains: (target: unknown) => target === inside,
  querySelector: () => ({ focus() { focused++; } }) };
mock.module("react", { exports: { ...React,
  useEffect(next: typeof effect) { effect = next; },
  useRef() { return { current: element }; },
} });
const { NotebookSelectionMenu } = await import("@/features/pdf-editor/components/NotebookSelectionMenu");

test("選択メニューは外側・フォーカス移動で閉じ、内部のチェック操作では閉じない", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document"), events = new EventTarget();
  Object.defineProperty(globalThis, "document", { configurable: true, value: events });
  let dismissed = 0;
  NotebookSelectionMenu({ open: true, onDismiss() { dismissed++; }, children: null });
  const cleanup = effect!();
  try {
    for (const type of ["click", "focusin"]) {
      const event = new Event(type); Object.defineProperty(event, "target", { value: inside });
      events.dispatchEvent(event);
      assert.equal(dismissed, type === "click" ? 0 : 1);
      events.dispatchEvent(new Event(type));
    }
    assert.equal(dismissed, 2);
    cleanup?.(); events.dispatchEvent(new Event("click"));
    assert.equal(dismissed, 2);
    NotebookSelectionMenu({ open: false, onDismiss() { dismissed++; }, children: null });
    assert.equal(effect!(), undefined);
  } finally {
    cleanup?.();
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});

test("選択メニューのEscapeは一覧へ伝えず、同じボタンへ戻す", () => {
  let dismissed = 0, stopped = 0, prevented = 0;
  focused = 0;
  const props = { onDismiss() { dismissed++; }, children: null };
  const event = { key: "Escape", preventDefault() { prevented++; }, stopPropagation() { stopped++; } } as React.KeyboardEvent<HTMLDivElement>;
  NotebookSelectionMenu({ ...props, open: true }).props.onKeyDown(event);
  assert.equal(dismissed, 1); assert.equal(stopped, 1); assert.equal(prevented, 1); assert.equal(focused, 1);
  NotebookSelectionMenu({ ...props, open: false }).props.onKeyDown(event);
  assert.equal(dismissed, 1); assert.equal(stopped, 1);
});


test("一覧へのポインター操作はクリックが届くまでメニューを閉じない", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document"), events = new EventTarget();
  Object.defineProperty(globalThis, "document", { configurable: true, value: events });
  let dismissed = 0;
  NotebookSelectionMenu({ open: true, onDismiss() { dismissed++; }, children: null });
  const cleanup = effect!();
  try {
    events.dispatchEvent(new Event("pointerdown"));
    events.dispatchEvent(new Event("focusin"));
    assert.equal(dismissed, 0);
    events.dispatchEvent(new Event("pointerup"));
    assert.equal(dismissed, 0);
    events.dispatchEvent(new Event("click"));
    assert.equal(dismissed, 1);
  } finally {
    cleanup?.();
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});
