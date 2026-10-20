import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import * as React from "react";
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import type { TextNote } from "@/features/pdf-editor/types";

let states: { value: unknown }[] = [];
let refs: { current: unknown }[] = [];
let cursor = 0;
let refCursor = 0;
let effects: (() => void | (() => void))[] = [];
let cleanups: (() => void)[] = [];
mock.module("react", { exports: {
  ...React,
  useState: <T,>(initial: T) => {
    const slot = states[cursor++] ??= { value: initial };
    return [slot.value, (next: T) => { slot.value = next; }];
  },
  useRef: (initial: unknown) => refs[refCursor++] ??= { current: initial },
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
} });
const { TextBoxEditor } = await import("@/features/pdf-editor/components/TextBoxEditor");
const { TextSizeControl } = await import("@/features/pdf-editor/components/TextSizeControl");
const font = fontkit.create(new Uint8Array(readFileSync(new URL("../public/fonts/NotoSansJP-Regular.otf", import.meta.url))));
const note: TextNote = { id: "one", kind: "text", text: "授業", x: 0.1, y: 0.2, width: 0.5, fontSize: 14 };

class Events {
  visibilityState = "visible";
  listeners = new Map<string, Set<(event: unknown) => void>>();
  addEventListener(type: string, handler: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
  }
  removeEventListener(type: string, handler: (event: unknown) => void) { this.listeners.get(type)?.delete(handler); }
  emit(type: string, target: unknown = {}) {
    const event = { type, target, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    for (const handler of [...this.listeners.get(type) ?? []]) handler(event);
    return event;
  }
}
let doc: Events;
let win: Events;
const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
beforeEach(() => {
  states = []; refs = []; cursor = 0; refCursor = 0; effects = []; cleanups = [];
  doc = new Events(); win = new Events();
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
});
afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else Reflect.deleteProperty(globalThis, "document");
  if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
});

function find(node: React.ReactNode, predicate: (element: React.ReactElement) => boolean): React.ReactElement | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) continue;
    if (predicate(child)) return child;
    const result = find(child.props.children, predicate);
    if (result) return result;
  }
}
function fixture(existing = true, initial = note, openedByPointer = false) {
  const commits: TextNote[] = [];
  let cancelled = 0;
  let removed = 0;
  let focused = 0;
  const inside = {};
  const root = { contains: (target: unknown) => target === inside };
  function render() {
    cleanups.forEach((cleanup) => cleanup()); cleanups = [];
    cursor = 0; refCursor = 0; effects = [];
    const tree = TextBoxEditor({ note: initial, font, pageWidth: 400, pageHeight: 600, pageScale: 1.5, existing, openedByPointer,
      onCommit: (next) => { commits.push(next); }, onCancel: () => { cancelled++; }, onDelete: () => { removed++; } });
    refs[0].current = root;
    refs[1].current = { focus: () => { focused++; } };
    for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
    return tree;
  }
  function input() { return find(render(), (element) => element.type === "textarea")!.props as React.ComponentProps<"textarea">; }
  function size() { return find(render(), (element) => element.type === TextSizeControl)!.props as React.ComponentProps<typeof TextSizeControl>; }
  function change(value: string) { input().onChange!({ target: { value } } as React.ChangeEvent<HTMLTextAreaElement>); render(); }
  function key(value: string, ctrlKey = false, isComposing = false) {
    const event = { key: value, ctrlKey, nativeEvent: { isComposing }, keyCode: isComposing ? 229 : 0,
      preventDefault() {} };
    input().onKeyDown!(event as React.KeyboardEvent<HTMLTextAreaElement>);
  }
  return { render, input, size, change, key, inside, commits, getCancelled: () => cancelled, getRemoved: () => removed, getFocused: () => focused };
}

test("ページ上のtextareaで入力し、外へフォーカスを移すと1回だけ確定する", () => {
  const f = fixture();
  f.change("日本語\r\n補足");
  assert.equal(f.commits.length, 0);
  f.input().onBlur!({ relatedTarget: null } as React.FocusEvent<HTMLTextAreaElement>);
  assert.equal(f.commits[0].text, "日本語\n補足");
  doc.emit("click");
  assert.equal(f.commits.length, 1);
  const tree = f.render();
  assert.equal(find(tree, (element) => element.type === "dialog"), undefined);
  assert.equal((tree.props as React.HTMLAttributes<HTMLDivElement>).style?.transform, "scale(1.5)");
});

function colorInput(f: ReturnType<typeof fixture>, label: string) {
  return find(f.render(), (element) => element.type === "input"
    && (element.props as { "aria-label"?: string })["aria-label"] === label)?.props as React.ComponentProps<"input"> | undefined;
}

test("テキストの文字色をプレビューし、色だけの変更では旧幅・高さを変えない", () => {
  const original = { ...note, height: 0.2 };
  const f = fixture(true, original);
  assert.equal(colorInput(f, "文字色")!.value, "#111827");
  assert.equal(colorInput(f, "付箋の背景色"), undefined);
  colorInput(f, "文字色")!.onChange!({ target: { value: "#3366cc" } } as React.ChangeEvent<HTMLInputElement>);
  assert.equal(f.input().style?.color, "#3366cc");
  assert.equal(f.commits.length, 0);
  // カラー欄へフォーカスを移しても確定しない。
  f.input().onBlur!({ relatedTarget: f.inside } as React.FocusEvent<HTMLTextAreaElement>);
  assert.equal(f.commits.length, 0);
  f.key("Enter", true);
  assert.equal(f.commits[0].color, "#3366cc");
  assert.equal(f.commits[0].width, original.width);
  assert.equal(f.commits[0].height, original.height);
  assert.equal(f.commits[0].autoSize, undefined);
  assert.equal(note.color, undefined);
});

test("付箋の文字色・背景色と文章・サイズを1回で確定し、キャンセル時は変更しない", () => {
  const f = fixture(true, { ...note, kind: "sticky" });
  colorInput(f, "文字色")!.onChange!({ target: { value: "#123456" } } as React.ChangeEvent<HTMLInputElement>);
  colorInput(f, "付箋の背景色")!.onChange!({ target: { value: "#fedcba" } } as React.ChangeEvent<HTMLInputElement>);
  f.change("色付き付箋");
  f.size().onChange(24);
  assert.equal(f.input().style?.color, "#123456");
  assert.equal(f.input().style?.background, "#fedcba");
  assert.equal(f.commits.length, 0);
  doc.emit("pointerdown");
  assert.equal(f.commits.length, 1);
  assert.equal(f.commits[0].text, "色付き付箋");
  assert.equal(f.commits[0].color, "#123456");
  assert.equal(f.commits[0].backgroundColor, "#fedcba");
  assert.equal(f.commits[0].fontSize, 24);
  states = []; refs = [];
  const cancelled = fixture(true, { ...note, kind: "sticky", color: "#123456", backgroundColor: "#fedcba" });
  colorInput(cancelled, "付箋の背景色")!.onChange!({ target: { value: "#ffffff" } } as React.ChangeEvent<HTMLInputElement>);
  cancelled.key("Escape");
  doc.emit("pointerdown");
  assert.equal(cancelled.commits.length, 0);
  assert.equal(cancelled.getCancelled(), 1);
});

test("不正な色とIME変換中の色変更を拒否し、元の色を残す", () => {
  const f = fixture(true, { ...note, color: "#123456" });
  colorInput(f, "文字色")!.onChange!({ target: { value: "red" } } as React.ChangeEvent<HTMLInputElement>);
  assert.equal(f.input().style?.color, "#123456");
  f.input().onCompositionStart!({} as React.CompositionEvent<HTMLTextAreaElement>);
  colorInput(f, "文字色")!.onChange!({ target: { value: "#ffffff" } } as React.ChangeEvent<HTMLInputElement>);
  assert.equal(f.input().style?.color, "#123456");
});

test("空の新規ボックスは保存せず、Escape・キャンセルで元の文章を維持する", () => {
  const f = fixture(false, { ...note, text: "" });
  f.input().onBlur!({ relatedTarget: null } as React.FocusEvent<HTMLTextAreaElement>);
  assert.equal(f.commits.length, 0);
  assert.equal(f.getCancelled(), 1);
  // 次の編集セッション。
  states = []; refs = [];
  const existing = fixture();
  existing.change("未確定");
  existing.key("Escape");
  doc.emit("pointerdown");
  assert.equal(existing.getCancelled(), 1);
  assert.equal(existing.commits.length, 0);
});

test("設置を始めたpointerdownと同じclickで空のボックスを閉じず、次の外側操作で確定する", () => {
  const f = fixture(false, { ...note, text: "", autoSize: true }, true);
  f.render();
  doc.emit("click");
  assert.equal(f.getCancelled(), 0);
  assert.equal(f.commits.length, 0);
  f.change("設置できたテキスト");
  doc.emit("pointerdown");
  doc.emit("click");
  assert.equal(f.commits.length, 1);
  assert.equal(f.commits[0].text, "設置できたテキスト");
});

test("日本語の変換中はEscape・完了キーで確定せず、変換後のCtrl+Enterで確定する", () => {
  const f = fixture();
  f.change("へんかん");
  f.input().onCompositionStart!({} as React.CompositionEvent<HTMLTextAreaElement>);
  f.key("Escape"); f.key("Enter", true);
  assert.equal(f.getCancelled(), 0);
  assert.equal(f.commits.length, 0);
  assert.equal(doc.emit("pointerdown").prevented, true);
  f.input().onCompositionEnd!({} as React.CompositionEvent<HTMLTextAreaElement>);
  f.change("変換");
  f.key("Enter", true);
  assert.equal(f.commits[0].text, "変換");
});

test("ページ・道具・PDF出力等の外部クリックより前に確定し、内部ボタンへの移動では確定しない", () => {
  const f = fixture();
  f.change("最新版");
  doc.emit("pointerdown", f.inside);
  assert.equal(f.commits.length, 0);
  assert.equal(doc.emit("pointerdown").prevented, false);
  assert.equal(f.commits[0].text, "最新版");
  doc.emit("click");
  assert.equal(f.commits.length, 1);
});

test("非対応文字・空の既存文章・長すぎる文章は草稿を残し、外部操作を止める", () => {
  for (const text of ["😀", " ", "文".repeat(2001), "行\n".repeat(100)]) {
    states = []; refs = [];
    const f = fixture();
    f.change(text);
    const event = doc.emit("pointerdown");
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    assert.equal(f.commits.length, 0);
    assert.equal(f.input().value, text);
    assert.ok(find(f.render(), (element) => (element.props as { role?: string }).role === "alert"));
    assert.ok(f.getFocused() > 0);
  }
});

test("非表示・pagehide時に文章を確定し、二重保存しない。イベントは解除する", () => {
  const f = fixture();
  f.change("閉じる前のメモ");
  doc.visibilityState = "hidden";
  doc.emit("visibilitychange");
  win.emit("pagehide");
  assert.equal(f.commits.length, 1);
  cleanups.forEach((cleanup) => cleanup()); cleanups = [];
  assert.equal(doc.listeners.get("pointerdown")?.size, 0);
  assert.equal(win.listeners.get("pagehide")?.size, 0);
});

test("入力欄の削除は草稿を確定せずに削除だけを通知する", () => {
  const f = fixture();
  f.change("削除する草稿");
  const button = find(f.render(), (element) => element.type === "button"
    && (element.props as { children?: string }).children === "削除")!;
  (button.props as React.ComponentProps<"button">).onClick!({} as React.MouseEvent<HTMLButtonElement>);
  doc.emit("pointerdown");
  assert.equal(f.commits.length, 0);
  assert.equal(f.getRemoved(), 1);
});

test("文字サイズを連続プレビューし、文章と箱サイズを1回の確定でまとめて渡す", () => {
  const f = fixture(false, { ...note, text: "", autoSize: true });
  f.change("大きさを調整する");
  f.size().onChange(20);
  f.size().onChange(32);
  assert.equal(f.size().value, 32);
  assert.equal(f.input().style?.fontSize, 32);
  assert.equal(f.commits.length, 0);
  f.input().onBlur!({ relatedTarget: f.inside } as unknown as React.FocusEvent<HTMLTextAreaElement>);
  assert.equal(f.commits.length, 0);
  doc.emit("pointerdown");
  assert.equal(f.commits.length, 1);
  assert.equal(f.commits[0].text, "大きさを調整する");
  assert.equal(f.commits[0].fontSize, 32);
  assert.equal(f.commits[0].autoSize, true);
  assert.ok(f.commits[0].width > note.width);
});

test("付箋も背景付きの直接入力とサイズ調整を使い、種類を変えずにまとめて確定する", () => {
  const f = fixture(false, { ...note, kind: "sticky", text: "", autoSize: true }, true);
  f.render();
  doc.emit("click");
  assert.equal(f.getCancelled(), 0);
  assert.equal(f.input()["aria-label"], "付箋");
  assert.equal(f.input().style?.background, "#fff3b0");
  f.change("付箋の補足\n復習");
  f.size().onChange(24);
  assert.equal(f.input().style?.fontSize, 24);
  assert.equal(f.commits.length, 0);
  f.key("Enter", true);
  assert.equal(f.commits.length, 1);
  assert.equal(f.commits[0].kind, "sticky");
  assert.equal(f.commits[0].fontSize, 24);
  assert.equal(f.commits[0].autoSize, true);
  assert.equal(f.commits[0].text, "付箋の補足\n復習");
});

test("旧付箋の文字サイズ変更はキャンセルでき、不正な文章も入力欄に残す", () => {
  const original: TextNote = { ...note, kind: "sticky" };
  const f = fixture(true, original);
  f.size().onChange(30);
  f.change("😀");
  assert.equal(doc.emit("pointerdown").prevented, true);
  assert.equal(f.input().value, "😀");
  assert.equal(f.commits.length, 0);
  f.key("Escape");
  assert.equal(f.getCancelled(), 1);
  assert.equal(f.commits.length, 0);
  assert.equal(original.fontSize, 14);
  assert.equal(original.autoSize, undefined);
});

test("サイズ変更のキャンセルと、範囲外・変換中・ページを超えるサイズの拒否", () => {
  const f = fixture(true, { ...note, height: 0.3 });
  for (const value of [0, 7, 49, NaN, 16.5]) f.size().onChange(value);
  assert.equal(f.size().value, 14);
  f.input().onCompositionStart!({} as React.CompositionEvent<HTMLTextAreaElement>);
  f.size().onChange(30);
  assert.equal(f.size().value, 14);
  f.input().onCompositionEnd!({} as React.CompositionEvent<HTMLTextAreaElement>);
  f.change("行\n".repeat(18));
  f.size().onChange(48);
  assert.equal(f.size().value, 14);
  assert.equal(f.input().value, "行\n".repeat(18));
  assert.ok(find(f.render(), (element) => (element.props as { role?: string }).role === "alert"));
  f.key("Escape");
  assert.equal(f.getCancelled(), 1);
  assert.equal(f.commits.length, 0);
});
