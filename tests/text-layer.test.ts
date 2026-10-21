import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { renderToStaticMarkup } from "react-dom/server";
import type { EditorTool, TextNote } from "@/features/pdf-editor/types";

const bytes = new Uint8Array(readFileSync(new URL("../public/fonts/NotoSansJP-Regular.otf", import.meta.url)));
const font = { bytes, font: fontkit.create(bytes) };
let states: { value: unknown }[] = [];
let refs: { current: unknown }[] = [];
let stateCursor = 0;
let refCursor = 0;
const portalTargets: Element[] = [];
// 表示先への接続を検証する。実DOM上の配置はChromeで別途確認する。
mock.module("react-dom", { exports: {
  ...ReactDOM,
  createPortal: (children: React.ReactNode, container: Element) => {
    portalTargets.push(container);
    return React.createElement(React.Fragment, null, children);
  },
} });
mock.module("react", { exports: {
  ...React,
  useEffect: () => {},
  useState: <T,>(initial: T) => {
    const index = stateCursor++;
    const slot = states[index] ??= { value: index === 0 ? font : initial };
    return [slot.value, (next: T | ((old: T) => T)) => {
      slot.value = typeof next === "function" ? (next as (old: T) => T)(slot.value as T) : next;
    }];
  },
  useRef: (initial: unknown) => refs[refCursor++] ??= { current: initial },
} });
const { TextLayer } = await import("@/features/pdf-editor/components/TextLayer");
const { TextNoteDialog } = await import("@/features/pdf-editor/components/TextNoteDialog");
const { TextBoxEditor } = await import("@/features/pdf-editor/components/TextBoxEditor");
beforeEach(() => { states = []; refs = []; stateCursor = 0; refCursor = 0; portalTargets.length = 0; });

function find(node: React.ReactNode, predicate: (element: React.ReactElement) => boolean): React.ReactElement | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) continue;
    if (predicate(child)) return child;
    const result = find(child.props.children, predicate);
    if (result) return result;
  }
}

const note: TextNote = { id: "one", kind: "text", text: "授業", x: 0.1, y: 0.1, width: 0.5, fontSize: 14 };

function fixture(tool: EditorTool, initial: TextNote[] = []) {
  let notes = initial;
  let updates = 0;
  let disabled = false;
  let controlsContainer: HTMLDivElement | null = {} as HTMLDivElement;
  function render() {
    stateCursor = 0;
    refCursor = 0;
    return TextLayer({ notes, tool, pageWidth: 400, pageHeight: 600, controlsContainer, disabled,
      onChange: (next) => { updates++; notes = next; } });
  }
  function handlers() {
    return find(render(), (element) => element.type === "svg")!.props as Record<string, (event: unknown) => void>;
  }
  function editor() { return find(render(), (element) => element.type === TextBoxEditor)!.props as React.ComponentProps<typeof TextBoxEditor>; }
  function event(x: number, y: number, id: string | null = null, pointerId = 1, button = 0, action: string | null = null) {
    return { clientX: x, clientY: y, pointerId, button, pointerType: "mouse",
      prevented: false, preventDefault() { this.prevented = true; },
      currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }), setPointerCapture: () => {} },
      target: { closest: (selector: string) => selector === "[data-note-action]"
        ? action ? { getAttribute: () => action } : null : id ? { getAttribute: () => id } : null } };
  }
  return { render, handlers, editor, event, getNotes: () => notes, getUpdates: () => updates,
    getControlsContainer: () => controlsContainer,
    removeControlsContainer: () => { controlsContainer = null; }, disable: () => { disabled = true; } };
}

test("テキスト・付箋のボタンは設定行へ渡し、PDF右上に操作欄を重ねない", () => {
  for (const tool of ["text", "sticky"] as const) {
    states = []; refs = []; portalTargets.length = 0;
    const f = fixture(tool);
    const rendered = f.render();
    assert.equal(portalTargets.length, 1);
    assert.equal(portalTargets[0], f.getControlsContainer());
    const controls = find(rendered, (element) => (element.props as { role?: string }).role === "group")!;
    assert.equal((controls.props as React.ComponentProps<"div">)["aria-label"], tool === "sticky" ? "付箋の操作" : "テキストの操作");
    assert.doesNotMatch((controls.props as React.ComponentProps<"div">).className!, /absolute|right-0|top-0/);
    assert.equal(f.getUpdates(), 0);
  }
});

test("設定行がない間・操作不可・ペン選択中はボタンをPDF上へ戻さない", () => {
  for (const mode of ["missing", "disabled", "pen"] as const) {
    states = []; refs = []; portalTargets.length = 0;
    const f = fixture(mode === "pen" ? "pen" : "text");
    if (mode === "missing") f.removeControlsContainer();
    if (mode === "disabled") f.disable();
    assert.equal(find(f.render(), (element) => element.type === "button"), undefined);
    assert.equal(portalTargets.length, 0);
    assert.equal(f.getUpdates(), 0);
  }
});

test("設定行へ移した文章編集・削除ボタンも選択中のメモだけを操作する", () => {
  const f = fixture("text", [note, { ...note, id: "two", text: "別のメモ" }]);
  f.handlers().onPointerDown(f.event(50, 80, note.id));
  f.editor().onCommit(note);
  function click(label: string) {
    const button = find(f.render(), (element) => element.type === "button"
      && (element.props as { children?: string }).children === label)!;
    (button.props as React.ComponentProps<"button">).onClick!({} as React.MouseEvent<HTMLButtonElement>);
  }
  click("文章編集");
  assert.equal(f.editor().note.id, note.id);
  f.editor().onCommit({ ...note, text: "修正" });
  assert.equal(f.getUpdates(), 1);
  click("削除");
  assert.deepEqual(f.getNotes().map((item) => item.id), ["two"]);
  assert.equal(f.getUpdates(), 2);
});

test("テキスト・付箋は直接入力の確定まで保存せず、キャンセルした新規入力を残さない", () => {
  for (const tool of ["text", "sticky"] as const) {
    states = []; refs = [];
    const f = fixture(tool);
    f.handlers().onPointerDown(f.event(20, 30));
    assert.equal(f.getUpdates(), 0);
    assert.equal(f.editor().note.kind, tool);
    assert.equal(f.editor().note.autoSize, true);
    f.editor().onCancel();
    assert.equal(f.getUpdates(), 0);
    f.handlers().onPointerDown(f.event(390, 590));
    f.editor().onCommit({ ...f.editor().note, text: "授業メモ\n復習" });
    assert.equal(f.getUpdates(), 1);
    assert.equal(f.getNotes()[0].text, "授業メモ\n復習");
    assert.equal(f.getNotes()[0].kind, tool);
    assert.ok(f.getNotes()[0].x + f.getNotes()[0].width <= 1);
  }
});

test("付箋の追加ボタンと既存付箋は同じ直接入力を使い、旧幅は開くだけでは変えない", () => {
  const sticky: TextNote = { ...note, kind: "sticky" };
  const f = fixture("sticky", [sticky]);
  const button = find(f.render(), (element) => element.type === "button"
    && (element.props as { children?: string }).children === "付箋を追加")!;
  (button.props as React.ComponentProps<"button">).onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.equal(f.editor().note.kind, "sticky");
  assert.equal(f.editor().note.autoSize, true);
  assert.equal(f.editor().openedByPointer, false);
  f.editor().onCancel();
  const event = f.event(50, 80, note.id);
  f.handlers().onPointerDown(event);
  assert.equal(event.prevented, true);
  assert.equal(f.editor().openedByPointer, true);
  assert.equal(find(f.render(), (element) => element.type === TextNoteDialog), undefined);
  f.editor().onCommit(sticky);
  assert.equal(f.getUpdates(), 0);
  assert.equal(f.getNotes()[0].width, sticky.width);
  f.handlers().onPointerDown(f.event(50, 80, note.id));
  f.editor().onCommit({ ...sticky, text: "変更後", fontSize: 24, autoSize: true });
  assert.equal(f.getNotes()[0].kind, "sticky");
  assert.equal(f.getNotes()[0].fontSize, 24);
  f.handlers().onPointerDown(f.event(50, 80, note.id));
  f.editor().onDelete!();
  assert.deepEqual(f.getNotes(), []);
});

test("既存メモのクリックで編集し、同文の適用は更新せず、削除を通知する", () => {
  const f = fixture("text", [note]);
  f.handlers().onPointerDown(f.event(50, 80, note.id));
  f.handlers().onPointerUp(f.event(50, 80));
  assert.equal(f.editor().note.id, note.id);
  f.editor().onCommit(note);
  assert.equal(f.getUpdates(), 0);
  f.handlers().onPointerDown(f.event(50, 80, note.id));
  f.handlers().onPointerUp(f.event(50, 80));
  f.editor().onCommit({ ...f.editor().note, text: "変更" });
  assert.equal(f.getNotes()[0].text, "変更");
  f.handlers().onPointerDown(f.event(50, 80, note.id));
  f.handlers().onPointerUp(f.event(50, 80));
  f.editor().onDelete!();
  assert.deepEqual(f.getNotes(), []);
});

test("ドラッグの移動中は保存せず、指を離した時だけ位置を更新する", () => {
  const f = fixture("sticky", [{ ...note, kind: "sticky" }]);
  f.handlers().onPointerDown(f.event(40, 60, note.id, 1, 0, "move"));
  f.handlers().onPointerMove(f.event(100, 150));
  assert.equal(f.getUpdates(), 0);
  f.handlers().onPointerUp(f.event(120, 180));
  assert.equal(f.getUpdates(), 1);
  assert.ok(Math.abs(f.getNotes()[0].x - 0.3) < 1e-8);
  assert.ok(Math.abs(f.getNotes()[0].y - 0.3) < 1e-8);
});

test("移動中断・別ポインター・右クリック・ペンモードではメモを変更しない", () => {
  const f = fixture("text", [note]);
  f.handlers().onPointerDown(f.event(40, 60, note.id, 1, 0, "move"));
  f.handlers().onPointerMove(f.event(300, 400, null, 2));
  f.handlers().onPointerUp(f.event(300, 400, null, 2));
  f.handlers().onPointerMove(f.event(100, 150));
  f.handlers().onPointerCancel(f.event(100, 150));
  f.handlers().onPointerUp(f.event(100, 150));
  assert.equal(f.getUpdates(), 0);
  f.handlers().onPointerDown(f.event(10, 10, null, 1, 2));
  assert.equal(f.getUpdates(), 0);
  states = []; refs = [];
  const pen = fixture("pen", [note]);
  pen.handlers().onPointerDown(pen.event(10, 10));
  assert.equal(pen.getUpdates(), 0);
});

test("未対応文字は適用前に拒否し、読み込み済みの未対応メモも編集して修正できる", () => {
  const f = fixture("text", [note]);
  f.handlers().onPointerDown(f.event(10, 10));
  assert.throws(() => f.editor().onCommit({ ...f.editor().note, text: "😀" }), /出力できません/);
  assert.equal(f.getUpdates(), 0);
  states = []; refs = [];
  const existing = fixture("text", [{ ...note, text: "😀" }]);
  existing.handlers().onPointerDown(existing.event(50, 80, note.id));
  existing.editor().onCommit({ ...existing.editor().note, text: "修正" });
  assert.equal(existing.getNotes()[0].text, "修正");
});

test("テキストはモーダルでなくページ内で入力し、移動枠だけ表示してリサイズハンドルを出さない", () => {
  const f = fixture("text", [note]);
  f.handlers().onPointerDown(f.event(50, 80, note.id));
  assert.ok(find(f.render(), (element) => element.type === TextBoxEditor));
  assert.equal(find(f.render(), (element) => element.type === TextNoteDialog), undefined);
  f.editor().onCommit(note);
  const markup = renderToStaticMarkup(f.render());
  assert.doesNotMatch(markup, /aria-label="サイズ変更 /);
  assert.match(markup, /data-note-action="move"/);
});

test("選択中でも空白の1回クリックで新しいテキストを置け、既定フォーカス移動を止める", () => {
  const f = fixture("text", [note]);
  f.handlers().onPointerDown(f.event(50, 80, note.id));
  f.editor().onCancel();
  const event = f.event(240, 92);
  f.handlers().onPointerDown(event);
  assert.equal(event.prevented, true);
  assert.notEqual(f.editor().note.id, note.id);
  assert.equal(f.editor().note.autoSize, true);
  assert.equal(f.getUpdates(), 0);
});

test("明示的な追加ボタンで空のボックスを表示し、入力確定までは一覧を増やさない", () => {
  const f = fixture("text");
  const button = find(f.render(), (element) => element.type === "button"
    && (element.props as { children?: string }).children === "テキストを追加")!;
  (button.props as React.ComponentProps<"button">).onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.equal(f.editor().note.text, "");
  assert.equal(f.editor().note.autoSize, true);
  assert.equal(f.getUpdates(), 0);
  f.editor().onCommit({ ...f.editor().note, text: "新しいメモ" });
  assert.equal(f.getUpdates(), 1);
  assert.equal(f.getNotes()[0].text, "新しいメモ");
});

test("入力の外側の枠を押す一連の操作では、直前に確定した文章を移動で上書きしない", () => {
  const f = fixture("text", [note]);
  f.handlers().onPointerDown(f.event(50, 80, note.id));
  const beforeCommit = f.handlers();
  f.editor().onCommit({ ...note, text: "入力した最新版", height: 0.2 });
  // documentのcaptureで確定後、同じイベントのSVG側には直前のrenderのハンドラーが来る。
  beforeCommit.onPointerDown(f.event(40, 60, note.id, 1, 0, "move"));
  f.handlers().onPointerUp(f.event(80, 120));
  assert.equal(f.getNotes()[0].text, "入力した最新版");
  assert.equal(f.getNotes()[0].height, 0.2);
  assert.ok(Math.abs(f.getNotes()[0].x - 0.2) < 1e-8);
});

test("メモ内容はHTMLではなく文字として表示し、付箋だけに背景を付ける", () => {
  const f = fixture("pen", [note, { ...note, id: "sticky", kind: "sticky", text: "<script>test</script>" }]);
  const markup = renderToStaticMarkup(f.render());
  assert.match(markup, /fill="#fff3b0"/);
  assert.match(markup, /&lt;script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /font-family="OverlayNotes"/);
});

test("保存された文字色と付箋背景色をSVGに表示し、旧メモの色は維持する", () => {
  const f = fixture("pen", [{ ...note, color: "#3366cc" },
    { ...note, id: "sticky", kind: "sticky", color: "#cc0033", backgroundColor: "#aabbcc" },
    { ...note, id: "old-sticky", kind: "sticky" }]);
  const html = renderToStaticMarkup(f.render());
  for (const color of ["#3366cc", "#cc0033", "#aabbcc", "#111827", "#fff3b0"]) assert.ok(html.includes(`fill="${color}"`));
});
