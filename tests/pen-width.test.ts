import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PenWidthControl } from "@/features/pdf-editor/components/PenWidthControl";
import { DEFAULT_PEN_WIDTH, PEN_WIDTH_OPTIONS } from "@/features/pdf-editor/penStyle";

function input(disabled: boolean, changes: number[]) {
  const element = PenWidthControl({ value: DEFAULT_PEN_WIDTH, disabled, onChange: (value) => changes.push(value) });
  const children = element.props.children as ReactElement<{
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  }>[];
  return (value: string) => children[1].props.onChange({ target: { value } } as ChangeEvent<HTMLInputElement>);
}

test("ペンの太さを5段階で表示し、標準は従来の太さを維持する", () => {
  assert.equal(PEN_WIDTH_OPTIONS.length, 5);
  assert.equal(PEN_WIDTH_OPTIONS[2].width, DEFAULT_PEN_WIDTH);
  PEN_WIDTH_OPTIONS.forEach((option, index) => {
    const markup = renderToStaticMarkup(PenWidthControl({ value: option.width, disabled: false, onChange: () => {} }));
    assert.match(markup, /<label[^>]*for="pen-width"[^>]*>ペンの太さ<\/label>/);
    assert.match(markup, /type="range"/);
    assert.match(markup, /min="0" max="4" step="1"/);
    assert.ok(markup.includes(`value="${index}"`));
    assert.ok(markup.includes(`aria-valuetext="${option.label}（${index + 1}/5）"`));
    assert.ok(markup.includes(`>${option.label}</output>`));
  });
});

test("スライダーの各段階を実際の線幅へ変換し、不正な段階は通知しない", () => {
  const changes: number[] = [];
  const change = input(false, changes);
  for (const value of ["0", "1", "2", "3", "4", "-1", "5", "1.5", "", "NaN"]) change(value);
  assert.deepEqual(changes, [1, 1.5, 2.5, 3.5, 5]);
});

test("消しゴム選択中や処理中はペンの太さを変更しない", () => {
  const changes: number[] = [];
  const markup = renderToStaticMarkup(PenWidthControl({ value: 2.5, disabled: true, onChange: () => {} }));
  assert.match(markup, /disabled=""/);
  input(true, changes)("4");
  assert.deepEqual(changes, []);
});
