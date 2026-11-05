import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import type { HeadingsByPage } from "@/features/pdf-editor/types";
import { resolveNotePages, insertBlankPage } from "@/features/pdf-editor/notePages";

let state: unknown;
beforeEach(() => { state = undefined; });
mock.module("react", { exports: { ...React, useState: (initial: unknown) => {
  if (state === undefined) state = initial;
  return [state, (next: unknown) => { state = next; }];
} } });
const { PageHeadingsPanel, PageHeadingEditor } = await import("@/features/pdf-editor/components/PageHeadingsPanel");
function find(node: React.ReactNode, predicate: (element: React.ReactElement<Record<string, unknown>>) => boolean): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<Record<string, unknown>>(child)) return [];
    return [...(predicate(child) ? [child] : []), ...find(child.props.children as React.ReactNode, predicate)];
  });
}

test("一覧は表示ページ順で見出しのあるページだけを表示し、安定IDで移動する", () => {
  const pages = insertBlankPage(resolveNotePages(undefined, 3), 1, 600, 800);
  const navigated: number[] = [];
  const headings: HeadingsByPage = { 3: "第三章", 4: "演習", 1: "はじめに" };
  const element = PageHeadingsPanel({ pages, headings, currentPageId: 4, disabled: false,
    onChange: () => {}, onNavigate: (id) => navigated.push(id) });
  const buttons = find(element, (el) => el.type === "button");
  assert.deepEqual(buttons.map((button) => find(button, (el) => el.type === "span")[0].props.children), [1, 2, 4]);
  assert.deepEqual(buttons.map((button) => button.props.title), ["はじめに", "演習", "第三章"]);
  assert.equal(buttons[1].props["aria-current"], "page");
  (buttons[1].props.onClick as () => void)(); assert.deepEqual(navigated, [4]);
  const editor = find(element, (el) => el.type === PageHeadingEditor)[0];
  assert.equal(editor.props.pageNumber, 2); assert.equal(editor.props.value, "演習");
});

test("未編集ページでも見出しを付けられ、処理中は編集・目次移動を止める", () => {
  let calls = 0;
  const element = PageHeadingsPanel({ pages: resolveNotePages(undefined, 2), headings: { 2: "メモなし" }, currentPageId: 1,
    disabled: true, onChange: () => calls++, onNavigate: () => calls++ });
  const editor = find(element, (el) => el.type === PageHeadingEditor)[0];
  assert.equal(editor.props.value, ""); assert.equal(editor.props.pageNumber, 1); assert.equal(editor.props.disabled, true);
  const button = find(element, (el) => el.type === "button")[0];
  assert.equal(button.props.disabled, true); (button.props.onClick as () => void)(); assert.equal(calls, 0);
});

test("入力中は通知せず、適用で確定し、キャンセル・削除・空欄による削除に対応する", () => {
  const calls: string[] = [];
  const render = () => PageHeadingEditor({ value: "元の見出し", pageNumber: 2, disabled: false, onApply: (value) => calls.push(value) });
  const input = () => find(render(), (el) => el.type === "input")[0];
  const submit = () => (render().props.onSubmit as React.FormEventHandler<HTMLFormElement>)({ preventDefault() {} } as React.FormEvent<HTMLFormElement>);
  (input().props.onChange as React.ChangeEventHandler<HTMLInputElement>)({ target: { value: " 下書き " } } as React.ChangeEvent<HTMLInputElement>);
  assert.deepEqual(calls, []); submit(); assert.deepEqual(calls, ["下書き"]);
  const cancel = find(render(), (el) => el.type === "button" && el.props.children === "キャンセル")[0];
  (cancel.props.onClick as () => void)(); assert.equal(input().props.value, "元の見出し");
  const remove = find(render(), (el) => el.type === "button" && el.props.children === "見出しを削除")[0];
  (remove.props.onClick as () => void)(); assert.deepEqual(calls, ["下書き", ""]);
  (input().props.onChange as React.ChangeEventHandler<HTMLInputElement>)({ target: { value: "" } } as React.ChangeEvent<HTMLInputElement>);
  submit(); assert.deepEqual(calls, ["下書き", "", ""]);
});

test("不正な長文や処理中は適用せず、IME変換中のEnterを送信に使わない", () => {
  const calls: string[] = [];
  const render = (disabled = false) => PageHeadingEditor({ value: "", pageNumber: 1, disabled, onApply: (value) => calls.push(value) });
  const input = find(render(), (el) => el.type === "input")[0];
  let prevented = false;
  (input.props.onKeyDown as React.KeyboardEventHandler<HTMLInputElement>)({ key: "Enter", nativeEvent: { isComposing: true },
    preventDefault() { prevented = true; } } as unknown as React.KeyboardEvent<HTMLInputElement>);
  assert.equal(prevented, true);
  (input.props.onChange as React.ChangeEventHandler<HTMLInputElement>)({ target: { value: "あ".repeat(121) } } as React.ChangeEvent<HTMLInputElement>);
  assert.equal(find(render(), (el) => el.type === "input")[0].props["aria-invalid"], true);
  assert.equal(find(render(), (el) => el.type === "button" && el.props.type === "submit")[0].props.disabled, true);
  (render().props.onSubmit as React.FormEventHandler<HTMLFormElement>)({ preventDefault() {} } as React.FormEvent<HTMLFormElement>);
  state = "短い見出し";
  (render(true).props.onSubmit as React.FormEventHandler<HTMLFormElement>)({ preventDefault() {} } as React.FormEvent<HTMLFormElement>);
  assert.deepEqual(calls, []);
});
