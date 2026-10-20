import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// dialogの呼び出しとイベント接続を検証する。実DOMのフォーカスやアニメーションは実機確認する。
let effects: (() => void)[] = [];
const dialog = {
  open: false,
  showCount: 0,
  closeCount: 0,
  showModal() { this.open = true; this.showCount++; },
  close() { this.open = false; this.closeCount++; },
};
mock.module("react", { exports: {
  ...React,
  useRef: () => ({ current: dialog }),
  useEffect: (effect: () => void) => { effects.push(effect); },
} });
const { NotebookDrawer } = await import("@/features/pdf-editor/components/NotebookDrawer");

beforeEach(() => { effects = []; dialog.open = false; dialog.showCount = 0; dialog.closeCount = 0; });

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as React.ReactNode)] : []);
}

function render(open = false, busy = false) {
  const calls = { open: 0, close: 0 };
  const node = NotebookDrawer({ open, busy, onOpen: () => { calls.open++; },
    onClose: () => { calls.close++; }, children: React.createElement("nav", null, "一覧") });
  effects.splice(0).forEach((effect) => effect());
  return { calls, node, entries: elements(node) };
}

test("初期状態は閉じたハンバーガーメニューで、左端の固定ダイアログを使用する", () => {
  const { entries, node } = render();
  const trigger = entries.find((entry) => entry.props["aria-label"] === "ノート一覧を開く")!;
  assert.equal(trigger.props["aria-expanded"], false);
  assert.equal(trigger.props["aria-haspopup"], "dialog");
  const modal = entries.find((entry) => entry.type === "dialog")!;
  assert.equal(trigger.props["aria-controls"], modal.props.id);
  assert.match(String(modal.props.className), /modal-start/);
  assert.equal(modal.props.open, undefined);
  assert.equal(dialog.showCount, 0);
  const html = renderToStaticMarkup(node);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /max-w-\[calc\(100vw-2rem\)\]/);
  assert.match(html, /motion-reduce:transition-none/);
});

test("開閉状態をnative dialogへ同期し、開いているdialogを二重に開かない", () => {
  render(true);
  assert.equal(dialog.showCount, 1);
  render(true);
  assert.equal(dialog.showCount, 1);
  render(false);
  assert.equal(dialog.closeCount, 1);
  assert.equal(dialog.open, false);
});

test("ハンバーガー、閉じる、背景ボタンを開閉へ接続する", () => {
  const { entries, calls } = render(true);
  for (const label of ["ノート一覧を開く", "ノート一覧を閉じる", "ノート一覧の外側を押して閉じる"]) {
    const button = entries.find((entry) => entry.props["aria-label"] === label)!;
    (button.props.onClick as () => void)();
  }
  assert.deepEqual(calls, { open: 1, close: 2 });
  const backdrop = entries.find((entry) => entry.props["aria-label"] === "ノート一覧の外側を押して閉じる")!;
  assert.equal(backdrop.props.tabIndex, -1);
});

test("Escapeで閉じるが、整理処理中は閉じず、子ダイアログのイベントは無視する", () => {
  for (const busy of [false, true]) {
    const { entries, calls } = render(true, busy);
    const modal = entries.find((entry) => entry.type === "dialog")!;
    let prevented = 0;
    const cancel = modal.props.onCancel as (event: unknown) => void;
    cancel({ target: dialog, currentTarget: dialog, preventDefault: () => { prevented++; } });
    assert.equal(prevented, 1);
    assert.equal(calls.close, busy ? 0 : 1);
    cancel({ target: {}, currentTarget: dialog, preventDefault: () => { prevented++; } });
    assert.equal(prevented, 1);
    const close = modal.props.onClose as (event: unknown) => void;
    close({ target: {}, currentTarget: dialog });
    assert.equal(calls.close, busy ? 0 : 1);
    close({ target: dialog, currentTarget: dialog });
    assert.equal(calls.close, busy ? 1 : 2);
    const button = entries.find((entry) => entry.props["aria-label"] === "ノート一覧を閉じる")!;
    assert.equal(button.props.disabled, busy);
    const backdrop = entries.find((entry) => entry.props["aria-label"] === "ノート一覧の外側を押して閉じる")!;
    assert.equal(backdrop.props.disabled, busy);
  }
});
