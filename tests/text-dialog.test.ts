import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TextNote } from "@/features/pdf-editor/types";

let states: { value: unknown }[] = [];
let refs: { current: unknown }[] = [];
let stateCursor = 0;
let refCursor = 0;
mock.module("react", { exports: {
  ...React, useEffect: () => {},
  useState: <T,>(initial: T) => {
    const slot = states[stateCursor++] ??= { value: initial };
    return [slot.value, (next: T) => { slot.value = next; }];
  },
  useRef: (value: unknown) => refs[refCursor++] ??= { current: value },
} });
const { TextNoteDialog } = await import("@/features/pdf-editor/components/TextNoteDialog");
beforeEach(() => { states = []; refs = []; stateCursor = 0; refCursor = 0; });
const note: TextNote = { id: "note", kind: "sticky", text: "以前の文章", x: 0.1, y: 0.1, width: 0.4, fontSize: 14 };

function fixture(fails = false) {
  const values: string[] = [];
  let closed = 0;
  let deleted = 0;
  function render() {
    stateCursor = 0; refCursor = 0;
    return TextNoteDialog({ note, onClose: () => { closed++; }, onDelete: () => { deleted++; }, onSubmit: (text) => {
      if (fails) throw new Error("ページが足りません");
      values.push(text);
    } });
  }
  function form() { return render().props.children; }
  function textarea() { return form().props.children[1]; }
  return { render, form, textarea, values, getClosed: () => closed, getDeleted: () => deleted };
}

test("入力中は保存せず、適用時に改行とタブを正規化して確定する", () => {
  const f = fixture();
  f.textarea().props.onChange({ target: { value: "日本語\r\nメモ\t重要" } });
  assert.deepEqual(f.values, []);
  f.form().props.onSubmit({ preventDefault() {} });
  assert.deepEqual(f.values, ["日本語\nメモ    重要"]);
});

test("IME変換中の確定・Escapeを拒否し、変換終了後に適用できる", () => {
  const f = fixture();
  f.textarea().props.onCompositionStart();
  f.form().props.onSubmit({ preventDefault() {} });
  f.render().props.onCancel({ preventDefault() {} });
  assert.equal(f.values.length, 0);
  assert.equal(f.getClosed(), 0);
  f.textarea().props.onCompositionEnd();
  f.form().props.onSubmit({ preventDefault() {} });
  assert.deepEqual(f.values, [note.text]);
});

test("空文や適用失敗時は入力を残し、キャンセル・削除を別操作にする", () => {
  const f = fixture(true);
  f.textarea().props.onChange({ target: { value: " " } });
  f.form().props.onSubmit({ preventDefault() {} });
  assert.match(renderToStaticMarkup(f.render()), /文章を入力してください/);
  f.textarea().props.onChange({ target: { value: "入力は維持" } });
  f.form().props.onSubmit({ preventDefault() {} });
  assert.match(renderToStaticMarkup(f.render()), /ページが足りません/);
  assert.equal(f.textarea().props.value, "入力は維持");
  f.form().props.children[3].props.children[0].props.onClick();
  assert.equal(f.getDeleted(), 1);
  f.render().props.onCancel({ preventDefault() {} });
  assert.equal(f.getClosed(), 1);
});
