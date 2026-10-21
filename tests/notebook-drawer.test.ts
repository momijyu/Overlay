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
  pickerCount: 0,
  click() { this.pickerCount++; },
  showModal() { this.open = true; this.showCount++; },
  close() { this.open = false; this.closeCount++; },
};
mock.module("react", { exports: {
  ...React,
  useRef: () => ({ current: dialog }),
  useEffect: (effect: () => void) => { effects.push(effect); },
} });
const { NotebookDrawer } = await import("@/features/pdf-editor/components/NotebookDrawer");

beforeEach(() => { effects = []; dialog.open = false; dialog.showCount = 0; dialog.closeCount = 0; dialog.pickerCount = 0; });

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as React.ReactNode)] : []);
}

function render(open = false, busy = false, pdfOpenDisabled = busy) {
  const calls = { close: 0, files: 0 };
  const node = NotebookDrawer({ open, busy, pdfOpenDisabled, onFileChange: () => { calls.files++; },
    onClose: () => { calls.close++; }, children: React.createElement("nav", null, "一覧") });
  effects.splice(0).forEach((effect) => effect());
  return { calls, node, entries: elements(node) };
}

test("初期状態は閉じた左端のダイアログで、開くボタンはヘッダー側へ分離する", () => {
  const { entries, node } = render();
  assert.equal(entries.find((entry) => entry.props["aria-label"] === "ノート一覧を開く"), undefined);
  const modal = entries.find((entry) => entry.type === "dialog")!;
  assert.equal(modal.props.id, "notebook-sidebar");
  assert.match(String(modal.props.className), /modal-start/);
  assert.equal(modal.props.open, undefined);
  assert.equal(dialog.showCount, 0);
  const html = renderToStaticMarkup(node);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /max-w-\[calc\(100vw-2rem\)\]/);
  assert.match(html, /motion-reduce:transition-none/);
  assert.match(html, /modal-box[^\"]*rounded-none/);
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

test("閉じる、背景ボタンを閉じる処理へ接続する", () => {
  const { entries, calls } = render(true);
  for (const label of ["ノート一覧を閉じる", "ノート一覧の外側を押して閉じる"]) {
    const button = entries.find((entry) => entry.props["aria-label"] === label)!;
    (button.props.onClick as () => void)();
  }
  assert.deepEqual(calls, { files: 0, close: 2 });
  const backdrop = entries.find((entry) => entry.props["aria-label"] === "ノート一覧の外側を押して閉じる")!;
  assert.equal(backdrop.props.tabIndex, -1);
});

test("メニュー内のPDFを追加ボタンで選択欄を呼び出し、処理中は開かない", () => {
  for (const disabled of [false, true]) {
    const { entries, calls } = render(true, false, disabled);
    const button = entries.find((entry) => entry.type === "button" && entry.props.children === "PDFを追加")!;
    const input = entries.find((entry) => entry.type === "input")!;
    assert.equal(button.props.disabled, disabled);
    assert.equal(input.props.disabled, disabled);
    assert.equal(input.props.hidden, true);
    assert.equal(input.props.accept, "application/pdf,.pdf");
    const before = dialog.pickerCount;
    (button.props.onClick as () => void)();
    assert.equal(dialog.pickerCount - before, disabled ? 0 : 1);
    (input.props.onChange as () => void)();
    assert.equal(calls.files, 1);
    assert.equal(calls.close, 0); // 選ぶ前には閉じず、キャンセルしても元のノートを維持。
  }
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
