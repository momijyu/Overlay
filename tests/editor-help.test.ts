import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { editorToolGroups } from "@/features/pdf-editor/editorTools";

let states: unknown[] = [], cursor = 0;
let effect: (() => void | (() => void)) | undefined;
let opened = 0, closed = 0, closeRequests = 0;
const dialog = { open: false, showModal() { this.open = true; opened++; }, close() { this.open = false; closed++; } };
mock.module("react", { exports: { ...React,
  useState(initial: unknown) {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], (next: unknown) => { states[index] = next; }];
  },
  useRef: () => ({ current: dialog }),
  useEffect: (next: typeof effect) => { effect = next; },
} });
const { EditorHelpDialog } = await import("@/features/pdf-editor/components/EditorHelpDialog");
beforeEach(() => { states = []; cursor = 0; opened = closed = closeRequests = 0; dialog.open = false; effect = undefined; });
function render() { cursor = 0; return EditorHelpDialog({ onClose() { closeRequests++; } }); }
function find(node: React.ReactNode, predicate: (element: React.ReactElement<Record<string, unknown>>) => boolean): React.ReactElement<Record<string, unknown>> | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<Record<string, unknown>>(child)) continue;
    if (predicate(child)) return child;
    const match = find(child.props.children as React.ReactNode, predicate);
    if (match) return match;
  }
}
function topic(value: string) {
  const select = find(render(), (entry) => entry.type === "select")!;
  (select.props.onChange as React.ChangeEventHandler<HTMLSelectElement>)({ target: { value } } as React.ChangeEvent<HTMLSelectElement>);
  return render();
}
function touch() {
  const button = find(render(), (entry) => entry.type === "button" && entry.props.children === "スマホ・iPad")!;
  (button.props.onClick as () => void)();
}

test("全11道具を用途別のアイコンと説明で案内し、初期の道具は変更しない", () => {
  const tools = editorToolGroups.flatMap((group) => group.tools);
  assert.equal(new Set(tools.map((entry) => entry.tool)).size, 11);
  const html = renderToStaticMarkup(topic("tools"));
  assert.equal((html.match(/<svg/g) ?? []).length, 11);
  for (const entry of tools) { assert.ok(html.includes(entry.label)); assert.ok(html.includes(entry.description)); }
  assert.match(html, /書き込み自体は動きません/);
  assert.match(html, /元PDFの図や文字は境界になりません/);
});

test("PCとスマホの説明を切り替え、入力・移動・コピーの違いを案内する", () => {
  let html = renderToStaticMarkup(topic("text"));
  assert.match(html, /Ctrl／Command\+Enter/);
  touch();
  html = renderToStaticMarkup(render());
  assert.match(html, /「編集」で入力を開きます/);
  assert.doesNotMatch(html, /Ctrl／Command\+Enter/);
  html = renderToStaticMarkup(topic("move"));
  assert.match(html, /二本指でページを移動/);
  assert.match(html, /「コピー」「貼り付け」で複製/);
});

test("保存の開始条件・Drive同期・PDFと編集用バックアップの違いを説明する", () => {
  assert.match(renderToStaticMarkup(render()), /開いただけのPDFは保存されません/);
  touch();
  const html = renderToStaticMarkup(topic("save"));
  for (const phrase of ["同じGoogleアカウント", "未送信の編集は端末に保持", "サイトデータを消すと失われ", "コピーを追加", "目隠しテープは出力しません", "右上の「…」"]) assert.ok(html.includes(phrase));
  assert.match(renderToStaticMarkup(topic("organize")), /ノート・フォルダの削除は元に戻せません/);
});

test("使い方をモーダルで開き、閉じる・Escape・背景操作で終了できる", () => {
  const tree = render(); const cleanup = effect!();
  assert.equal(opened, 1); assert.equal(dialog.open, true);
  const close = find(tree, (entry) => entry.type === "button" && entry.props.children === "閉じる")!;
  (close.props.onClick as () => void)();
  let prevented = false;
  (tree.props as React.ComponentProps<"dialog">).onCancel!({ preventDefault() { prevented = true; } } as React.SyntheticEvent<HTMLDialogElement>);
  const backdrop = find(tree, (entry) => entry.type === "form")!;
  (backdrop.props.onSubmit as React.FormEventHandler)({ preventDefault() {} } as React.FormEvent);
  assert.equal(closeRequests, 3); assert.equal(prevented, true);
  cleanup?.(); assert.equal(closed, 1); assert.equal(dialog.open, false);
});

test("タッチ画面から開いたときはスマホ・iPadの説明を初期表示する", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: true }) } });
  try {
    const html = renderToStaticMarkup(render());
    assert.match(html, /編集中は右上の「…」/);
    assert.match(renderToStaticMarkup(topic("organize")), /項目を長押ししてから/);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original); else Reflect.deleteProperty(globalThis, "window");
  }
});
