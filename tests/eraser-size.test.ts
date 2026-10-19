import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EraserSizeControl } from "@/features/pdf-editor/components/EraserSizeControl";

test("消しゴムサイズの範囲・刻み・現在値と入力ラベルを表示する", () => {
  const markup = renderToStaticMarkup(EraserSizeControl({ value: 16, disabled: false, onChange: () => {} }));
  assert.match(markup, /<label[^>]*for="eraser-width"[^>]*>消しゴムサイズ<\/label>/);
  assert.match(markup, /type="range"/);
  assert.match(markup, /min="4" max="64" step="1"/);
  assert.match(markup, /value="16"/);
  assert.match(markup, /<output[^>]*for="eraser-width"[^>]*>16<\/output>/);
});

function input(disabled: boolean, changes: number[]) {
  const element = EraserSizeControl({ value: 16, disabled, onChange: (value) => changes.push(value) });
  const children = element.props.children as ReactElement<{
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  }>[];
  return (value: string) => children[1].props.onChange({ target: { value } } as ChangeEvent<HTMLInputElement>);
}

test("消しゴムサイズの最小・中間・最大を通知し、範囲外や不正値を拒否する", () => {
  const changes: number[] = [];
  const change = input(false, changes);
  for (const value of ["4", "17", "64", "3", "65", "NaN", "", "16.5"]) change(value);
  assert.deepEqual(changes, [4, 17, 64]);
});

test("処理中の消しゴムサイズ入力を無効化する", () => {
  const changes: number[] = [];
  const markup = renderToStaticMarkup(EraserSizeControl({ value: 32, disabled: true, onChange: () => {} }));
  assert.match(markup, /disabled=""/);
  input(true, changes)("64");
  assert.deepEqual(changes, []);
});
