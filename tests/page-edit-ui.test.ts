import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PageClearSelection } from "@/features/pdf-editor/strokeHistory";

let selection: PageClearSelection;
let opened = 0, closed = 0;
const dialog = { showModal() { opened++; }, close() { closed++; } };
mock.module("react", { exports: { ...React, useRef: () => ({ current: dialog }), useEffect: () => {},
  useState: () => [selection, (next: PageClearSelection) => { selection = next; }] } });
const { PageActionsMenu } = await import("@/features/pdf-editor/components/PageActionsMenu");
const { PageEditDialog } = await import("@/features/pdf-editor/components/PageEditDialog");
beforeEach(() => { selection = { strokes: true, sticky: true, text: true }; opened = 0; closed = 0; });

function elements(node: React.ReactNode, type: string): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return [];
    return [...(child.type === type ? [child as React.ReactElement<Record<string, unknown>>] : []), ...elements(child.props.children, type)];
  });
}
const event = { preventDefault() {} };

test("ページ操作は最前面のdialogで表示し、処理中・最後の1ページ・空の書き込みを操作しない", () => {
  for (const disabled of [true, false]) {
    const calls: string[] = [];
    const tree = PageActionsMenu({ disabled, canInsert: true, canDelete: false, canClear: false,
      onInsert() { assert.ok(closed); calls.push("insert"); }, onDelete() { calls.push("delete"); }, onClear() { calls.push("clear"); } });
    const buttons = elements(tree, "button");
    assert.equal(buttons[0].props.children?.toString().trim(), "ページ操作");
    assert.doesNotMatch(renderToStaticMarkup(buttons[0]), /desktop-only/);
    (buttons[0].props.onClick as () => void)();
    assert.equal(opened, disabled ? 0 : 1);
    for (const button of buttons.slice(1, 4)) (button.props.onClick as () => void)();
    assert.deepEqual(calls, disabled ? [] : ["insert"]);
    const html = renderToStaticMarkup(tree);
    assert.match(html, /<dialog[^>]*aria-label="ページ操作"/);
    assert.match(html, /最後の1ページは削除できません/);
    assert.match(html, /書き込みを一括削除/);
  }
});

test("削除できるページと書き込みも、一覧を閉じて確認画面へ渡す", () => {
  const calls: string[] = [];
  const tree = PageActionsMenu({ disabled: false, canInsert: false, canDelete: true, canClear: true,
    onInsert() { calls.push("insert"); }, onDelete() { assert.ok(closed); calls.push("delete"); }, onClear() { assert.ok(closed); calls.push("clear"); } });
  for (const button of elements(tree, "button").slice(1, 4)) (button.props.onClick as () => void)();
  assert.deepEqual(calls, ["clear", "delete"]);
});

test("一括削除は種類別チェックと件数を表示し、空の種類と選択ゼロでの確定を無効にする", () => {
  const confirmed: PageClearSelection[] = [];
  const render = () => PageEditDialog({ kind: "clear-page", pageNumber: 7, counts: { strokes: 2, sticky: 1, text: 0 }, disabled: false,
    onClose() {}, onConfirm(value) { confirmed.push(value); } });
  let tree = render();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /7ページ/); assert.match(html, /線（マーカー含む）：2件/); assert.match(html, /テキストボックス：0件/);
  const inputs = elements(tree, "input");
  assert.equal(inputs[2].props.disabled, true); assert.equal(inputs[2].props.checked, false);
  (inputs[0].props.onChange as (event: unknown) => void)({ target: { checked: false } });
  tree = render();
  (elements(tree, "form")[0].props.onSubmit as (event: unknown) => void)(event);
  assert.deepEqual(confirmed, [{ strokes: false, sticky: true, text: true }]);
  (elements(tree, "input")[1].props.onChange as (event: unknown) => void)({ target: { checked: false } });
  tree = render();
  assert.equal(elements(tree, "button").find((button) => button.props.type === "submit")!.props.disabled, true);
  (elements(tree, "form")[0].props.onSubmit as (event: unknown) => void)(event);
  assert.equal(confirmed.length, 1);
});

test("ページ削除のキャンセル・Escape・背景は削除を実行せず、確定だけを呼ぶ", () => {
  let cancels = 0, confirms = 0;
  const tree = PageEditDialog({ kind: "delete-page", pageNumber: 2, counts: { strokes: 0, sticky: 0, text: 0 }, disabled: false,
    onClose() { cancels++; }, onConfirm() { confirms++; } });
  assert.equal(elements(tree, "input").length, 0);
  assert.match(renderToStaticMarkup(tree), /2ページと、このページの書き込みを削除します/);
  assert.match(renderToStaticMarkup(tree), /元に戻すで取り消せます/);
  (elements(tree, "button")[0].props.onClick as () => void)();
  (elements(tree, "dialog")[0].props.onCancel as (event: unknown) => void)(event);
  (elements(tree, "form")[1].props.onSubmit as (event: unknown) => void)(event);
  assert.equal(cancels, 3); assert.equal(confirms, 0);
  (elements(tree, "form")[0].props.onSubmit as (event: unknown) => void)(event);
  assert.equal(confirms, 1);
});
