import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let draft: string | null = null;
mock.module("react", { exports: { ...React, useState: () => [draft, (value: string | null) => { draft = value; }] } });
const { TextSizeControl } = await import("@/features/pdf-editor/components/TextSizeControl");
beforeEach(() => { draft = null; });

function inputs(node: React.ReactNode): React.ComponentProps<"input">[] {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return [];
    if (child.type === "input") return [child.props as React.ComponentProps<"input">];
    return inputs(child.props.children);
  });
}
function fixture(disabled = false) {
  let value = 14;
  const updates: number[] = [];
  function render() { return TextSizeControl({ value, disabled, onChange: (next) => { updates.push(next); value = next; } }); }
  function fields() { return inputs(render()); }
  function change(index: number, raw: string) { fields()[index].onChange!({ target: { value: raw } } as React.ChangeEvent<HTMLInputElement>); }
  return { render, fields, change, updates };
}

test("小〜大のスライダーと任意の数値指定を表示し、同じ8〜48の範囲を使う", () => {
  const f = fixture();
  const markup = renderToStaticMarkup(f.render());
  assert.match(markup, /文字サイズ/);
  assert.match(markup, />小</);
  assert.match(markup, />大</);
  assert.match(markup, /文字サイズを数値で指定/);
  for (const input of f.fields()) {
    assert.equal(input.min, 8); assert.equal(input.max, 48); assert.equal(input.step, 1);
  }
  f.change(0, "8"); f.change(0, "48"); f.change(1, "24");
  assert.deepEqual(f.updates, [8, 48, 24]);
});

test("数値欄を空にして打ち直せ、途中の範囲外値は文章へ渡さず、blurで最後の有効値へ戻す", () => {
  const f = fixture();
  f.change(1, "");
  assert.equal(f.fields()[1].value, "");
  f.change(1, "4");
  assert.deepEqual(f.updates, []);
  f.change(1, "40");
  assert.deepEqual(f.updates, [40]);
  f.change(1, "999");
  f.fields()[1].onBlur!({} as React.FocusEvent<HTMLInputElement>);
  assert.equal(f.fields()[1].value, 40);
});

test("不正なサイズ・小数・無効時の入力を通知しない", () => {
  const f = fixture();
  for (const raw of ["", "0", "7", "49", "NaN", "Infinity", "16.5"]) f.change(0, raw);
  assert.deepEqual(f.updates, []);
  const disabled = fixture(true);
  assert.ok(disabled.fields().every((input) => input.disabled));
  disabled.change(0, "24"); disabled.change(1, "24");
  assert.deepEqual(disabled.updates, []);
});
