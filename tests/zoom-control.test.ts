import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ZoomControl } from "@/features/pdf-editor/components/ZoomControl";

test("倍率は50〜200%・1%刻みのスライダーで表示し、現在値を読み上げられる", () => {
  const markup = renderToStaticMarkup(ZoomControl({ value: 1.256, disabled: false, onChange: () => {} }));
  assert.match(markup, /type="range"/);
  assert.match(markup, /min="50" max="200" step="1"/);
  assert.match(markup, /aria-valuetext="126%"/);
  assert.match(markup, /<output[^>]*>126%<\/output>/);
  assert.doesNotMatch(markup, /<select/);
});

test("スライダーは有効な整数パーセントだけ渡し、処理中は変更しない", () => {
  const changes: number[] = [];
  for (const disabled of [false, true]) {
    const control = ZoomControl({ value: 1, disabled, onChange: (next) => { changes.push(next); } });
    const input = control.props.children[1];
    assert.equal(input.props.disabled, disabled);
    for (const value of ["", "NaN", "49", "201", "120.5", "50", "125", "200"]) input.props.onChange({ target: { value } });
  }
  assert.deepEqual(changes, [0.5, 1.25, 2]);
});
