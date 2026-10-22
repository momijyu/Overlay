import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MARKER_OPACITY, PEN_COLOR, PEN_WIDTH_OPTIONS } from "@/features/pdf-editor/penStyle";
import type { PenStroke, PenTool } from "@/features/pdf-editor/types";
import { createPageInteraction, type PageInteraction } from "@/features/pdf-editor/pageGestures";

// 状態の保持だけを置き換えてポインターハンドラーを検証する。
// DOMのレイアウト・実機のPointer Capture・Reactの再描画を再現するテストではない。
let states: { value: unknown }[] = [];
mock.module("react", { exports: {
  ...React,
  useEffect: (effect: () => void) => effect(),
  useRef: (value: unknown) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => {
    const slot = { value: typeof initial === "function" ? (initial as () => T)() : initial };
    states.push(slot);
    return [slot.value, (next: T | ((previous: T) => T)) => {
      slot.value = typeof next === "function" ? (next as (previous: T) => T)(slot.value) : next;
    }];
  },
} });
const { PenLayer } = await import("@/features/pdf-editor/components/PenLayer");
beforeEach(() => { states = []; });

const line: PenStroke = { width: 2, color: "#ff0000", points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] };

function layer(tool: PenTool, strokes: PenStroke[] = [line], eraserWidth = 16, penWidth = 5, interaction?: PageInteraction) {
  const completed: PenStroke[] = [];
  const changes: PenStroke[][] = [];
  const captures: number[] = [];
  const element = PenLayer({
    tool, strokes, penWidth, penColor: "#1234ab", eraserWidth, pageScale: 1, pageWidth: 100, pageHeight: 100, interaction,
    onStrokeComplete: (stroke) => completed.push(stroke), onStrokesChange: (next) => changes.push(next),
  });
  const handlers = element.props as Record<"onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onLostPointerCapture", (event: unknown) => void>;
  function event(x: number, y: number, pointerId = 1, button = 0) {
    return { clientX: x, clientY: y, pointerId, button, pointerType: "mouse", currentTarget: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      setPointerCapture: (id: number) => captures.push(id),
    } };
  }
  return { handlers, event, completed, changes, captures, element };
}

test("描画時の色と太さを線へ記録し、移動中には保存せず離した時だけ通知する", () => {
  const { handlers, event, completed, captures } = layer("pen");
  handlers.onPointerDown(event(10, 20));
  handlers.onPointerMove(event(50, 60));
  assert.equal(completed.length, 0);
  handlers.onPointerUp(event(90, 80));
  assert.deepEqual(captures, [1]);
  assert.deepEqual(completed, [{ width: 5, color: "#1234ab", points: [
    { x: 0.1, y: 0.2 }, { x: 0.5, y: 0.6 }, { x: 0.9, y: 0.8 },
  ] }]);
});

test("マーカーは指を離した時に種別と色・太さを記録し、SVGも1本の半透明パスで描く", () => {
  const { handlers, event, completed } = layer("marker", [], 16, 20);
  handlers.onPointerDown(event(10, 20));
  handlers.onPointerMove(event(50, 20));
  assert.equal(completed.length, 0);
  handlers.onPointerUp(event(90, 20));
  assert.equal(completed[0].kind, "marker");
  assert.equal(completed[0].width, 20);
  assert.equal(completed[0].color, "#1234ab");
  const legacy = { width: 2.5, points: [{ x: 0.1, y: 0.1 }] };
  const html = renderToStaticMarkup(layer("marker", [completed[0], legacy]).element);
  assert.match(html, new RegExp(`stroke-opacity="${MARKER_OPACITY}"`));
  assert.match(html, /mix-blend-mode:multiply/);
  assert.equal([...html.matchAll(/stroke-opacity=/g)].length, 1);
  assert.match(html, /マーカーで書き込む領域/);
});

test("マーカーの中断では保存しない", () => {
  const { handlers, event, completed } = layer("marker", []);
  handlers.onPointerDown(event(10, 20));
  handlers.onPointerCancel(event(10, 20));
  handlers.onPointerUp(event(90, 20));
  assert.equal(completed.length, 0);
});

test("テキスト選択中のペン表示は入力を受けず、二重描画しない", () => {
  let completed = 0;
  const element = PenLayer({ tool: "pen", strokes: [], penWidth: 2, penColor: "#111827", eraserWidth: 16,
    pageScale: 1, pageWidth: 100, pageHeight: 100, interactive: false, onStrokeComplete: () => { completed++; }, onStrokesChange: () => {} });
  const handlers = element.props as Record<string, (event: unknown) => void>;
  handlers.onPointerDown({});
  handlers.onPointerUp({});
  assert.equal(completed, 0);
  assert.match(renderToStaticMarkup(element), /pointer-events:none/);
});

test("消しゴムは途中の表示だけ変更し、離した時に分割結果を一度だけ通知する", () => {
  const { handlers, event, completed, changes } = layer("eraser");
  handlers.onPointerDown(event(50, 0));
  handlers.onPointerMove(event(50, 100));
  assert.equal(changes.length, 0);
  assert.equal((states[1].value as PenStroke[]).length, 2);
  handlers.onPointerUp(event(50, 100));
  handlers.onLostPointerCapture(event(50, 100));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].length, 2);
  assert.ok(changes[0].every((stroke) => stroke.color === "#ff0000"));
  assert.equal(completed.length, 0);
  assert.equal(states[1].value, null);
});

test("ペンスライダーの5段階の太さを新しい線に記録する", () => {
  for (const { width } of PEN_WIDTH_OPTIONS) {
    const { handlers, event, completed } = layer("pen", [], 16, width);
    handlers.onPointerDown(event(10, 10));
    handlers.onPointerUp(event(80, 80));
    assert.equal(completed.length, 1);
    assert.equal(completed[0].width, width);
  }
});

test("選択した消しゴムサイズに応じて実際に消える範囲が変わる", () => {
  const remainingLengths = [4, 17, 64].map((width) => {
    const { handlers, event, changes } = layer("eraser", [line], width);
    handlers.onPointerDown(event(50, 50));
    handlers.onPointerUp(event(50, 50));
    assert.equal(changes.length, 1);
    assert.equal(changes[0].length, 2);
    return changes[0].reduce((sum, stroke) => sum + stroke.points.at(-1)!.x - stroke.points[0].x, 0);
  });
  assert.ok(remainingLengths[0] > remainingLengths[1]);
  assert.ok(remainingLengths[1] > remainingLengths[2]);
});

test("pointercancel・予期しないキャプチャ解除では描画も消去も確定しない", () => {
  for (const tool of ["pen", "eraser"] as const) {
    for (const cancel of ["onPointerCancel", "onLostPointerCapture"] as const) {
      states = [];
      const { handlers, event, completed, changes } = layer(tool);
      handlers.onPointerDown(event(50, 0));
      handlers.onPointerMove(event(50, 100));
      handlers[cancel](event(50, 100));
      handlers.onPointerUp(event(50, 100));
      assert.equal(completed.length, 0);
      assert.equal(changes.length, 0);
      assert.equal(states[0].value, null);
      assert.equal(states[1].value, null);
    }
  }
});

test("右クリックと別ポインターを無視し、開始したポインターだけで編集する", () => {
  const { handlers, event, completed, captures } = layer("pen");
  handlers.onPointerDown(event(10, 10, 1, 2));
  assert.equal(captures.length, 0);
  handlers.onPointerDown(event(10, 10));
  handlers.onPointerDown(event(20, 20, 2));
  handlers.onPointerUp(event(20, 20, 2));
  assert.equal(completed.length, 0);
  handlers.onPointerUp(event(30, 30));
  assert.equal(completed.length, 1);
  assert.deepEqual(captures, [1]);
});

test("何も触れない消しゴム操作は通知しない", () => {
  const { handlers, event, changes } = layer("eraser");
  handlers.onPointerDown(event(0, 0));
  handlers.onPointerUp(event(100, 0));
  assert.equal(changes.length, 0);
});

test("色なしの旧線は従来の黒、色付き線は記録した色で描画する", () => {
  const html = renderToStaticMarkup(layer("pen", [{ width: 2, points: line.points }, line]).element);
  assert.match(html, new RegExp(`stroke="${PEN_COLOR}"`));
  assert.match(html, /stroke="#ff0000"/);
});

test("PDF座標で線と点を描き、線幅を拡大補正するvector-effectに依存しない", () => {
  const html = renderToStaticMarkup(layer("pen", [line, { width: 3, points: [{ x: 0.2, y: 0.3 }] }]).element);
  assert.match(html, /viewBox="0 0 100 100"/);
  assert.match(html, /d="M 10 50 L 90 50"/);
  assert.match(html, /d="M 20 30 l 0.001 0"/);
  assert.match(html, /stroke-width="2"/);
  assert.doesNotMatch(html, /vector-effect/);
});

test("二本指へ切り替えると描画・消去の途中結果を破棄し、残った指でも確定しない", () => {
  for (const tool of ["pen", "marker", "eraser"] as const) {
    const interaction = createPageInteraction();
    const f = layer(tool, [line], 16, 5, interaction);
    f.handlers.onPointerDown(f.event(50, 0));
    f.handlers.onPointerMove(f.event(50, 100));
    interaction.blocked = true;
    interaction.cancellations.forEach((cancel) => cancel());
    f.handlers.onPointerUp(f.event(50, 100));
    f.handlers.onPointerDown(f.event(10, 10));
    assert.equal(f.completed.length, 0);
    assert.equal(f.changes.length, 0);
    assert.equal(states.at(-3)?.value ?? null, null);
    interaction.blocked = false;
    f.handlers.onPointerUp(f.event(50, 100));
    assert.equal(f.completed.length, 0);
  }
});
