import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let values: unknown[] = [], cursor = 0;
const dialog = { showModal() {}, close() {} };
mock.module("react", { exports: { ...React, useRef: () => ({ current: dialog }), useEffect: () => {},
  useState: (initial: unknown) => {
    const slot = cursor++;
    if (!(slot in values)) values[slot] = initial;
    return [values[slot], (value: unknown) => { values[slot] = value; }];
  } } });
const { PdfPageExportDialog } = await import("@/features/pdf-editor/components/PdfPageExportDialog");
beforeEach(() => { values = []; cursor = 0; });

function elements(node: React.ReactNode, type: string): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return [];
    return [...(child.type === type ? [child as React.ReactElement<Record<string, unknown>>] : []), ...elements(child.props.children, type)];
  });
}
const event = { preventDefault() {} };

test("現在ページを初期値にし、範囲の検証エラーを残して有効な指定だけを送る", () => {
  const calls: number[][] = [];
  const render = () => { cursor = 0; return PdfPageExportDialog({ pageNumber: 3, pageCount: 5, disabled: false, error: null, onClose() {}, onConfirm(pages) { calls.push(pages); } }); };
  let tree = render();
  assert.equal(elements(tree, "input")[0].props.value, "3");
  const change = (value: string) => { (elements(tree, "input")[0].props.onChange as (e: unknown) => void)({ target: { value } }); tree = render(); };
  const submit = () => { (elements(tree, "form")[0].props.onSubmit as (e: unknown) => void)(event); tree = render(); };
  change("0, 8"); submit(); assert.equal(calls.length, 0);
  assert.match(renderToStaticMarkup(tree), /role="alert"/);
  change("5, 1-3, 2"); submit(); assert.deepEqual(calls, [[1, 2, 3, 5]]);
  (elements(tree, "button")[0].props.onClick as () => void)(); tree = render();
  assert.equal(elements(tree, "input")[0].props.value, "3");
});

test("キャンセル・Escape・背景で出力せず、処理中は二重出力も閉じる操作も止める", () => {
  for (const disabled of [false, true]) {
    values = []; cursor = 0;
    let closes = 0, confirms = 0;
    const tree = PdfPageExportDialog({ pageNumber: 1, pageCount: 2, disabled, error: "出力失敗", onClose() { closes++; }, onConfirm() { confirms++; } });
    (elements(tree, "button")[1].props.onClick as () => void)();
    (elements(tree, "dialog")[0].props.onCancel as (e: unknown) => void)(event);
    (elements(tree, "form")[1].props.onSubmit as (e: unknown) => void)(event);
    assert.equal(closes, disabled ? 0 : 3); assert.equal(confirms, 0);
    (elements(tree, "form")[0].props.onSubmit as (e: unknown) => void)(event);
    assert.equal(confirms, disabled ? 0 : 1);
    assert.match(renderToStaticMarkup(tree), /出力失敗/);
    if (disabled) assert.match(renderToStaticMarkup(tree), /PDFを出力中/);
  }
});
