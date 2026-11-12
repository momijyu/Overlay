import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { createPageInteraction } from "@/features/pdf-editor/pageGestures";
import { annotationClipboard } from "@/features/pdf-editor/annotationClipboard";
import type { AnnotationContent } from "@/features/pdf-editor/annotationSelection";
import type { PenStroke, TextNote } from "@/features/pdf-editor/types";

const bytes = new Uint8Array(readFileSync(new URL("../public/fonts/NotoSansJP-Regular.otf", import.meta.url)));
const font = { bytes, font: fontkit.create(bytes) };
let states: { value: unknown }[] = [], refs: { current: unknown }[] = [], s = 0, r = 0;
mock.module("react", { exports: { ...React,
  useState: (initial: unknown) => {
    const slot = states[s++] ??= { value: typeof initial === "function" ? initial() : initial };
    return [slot.value, (next: unknown) => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
  },
  useRef: (initial: unknown) => refs[r++] ??= { current: initial },
  useMemo: (compute: () => unknown) => compute(),
  useSyncExternalStore: () => annotationClipboard.get(),
  useLayoutEffect: (effect: () => void) => effect(),
  useEffect: (effect: () => void, deps: unknown[]) => { if (deps?.length === 1) effect(); },
} });
mock.module("@/features/pdf-editor/noteFont", { exports: { loadedNoteFont: () => font, loadNoteFont: async () => font } });
const { LassoLayer } = await import("@/features/pdf-editor/components/LassoLayer");
beforeEach(() => { states = []; refs = []; s = 0; r = 0; annotationClipboard.set(""); });
function find(node: React.ReactNode, predicate: (e: React.ReactElement<Record<string, unknown>>) => boolean): React.ReactElement<Record<string, unknown>> | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<Record<string, unknown>>(child)) continue;
    if (predicate(child)) return child;
    const result = find(child.props.children as React.ReactNode, predicate); if (result) return result;
  }
}
function fixture() {
  let content: AnnotationContent = { strokes: [{ width: 3, points: [{ x: .2, y: .2 }, { x: .3, y: .3 }] }],
    texts: [{ id: "sticky", kind: "sticky", text: "復習", x: .2, y: .35, width: .2, fontSize: 14 }] };
  let changes = 0, disabled = false;
  const interaction = createPageInteraction();
  function render() { s = 0; r = 0; return LassoLayer({ ...content, pageWidth: 600, pageHeight: 800, pageScale: 1,
    interaction, disabled, controlsContainer: null, onChange: (strokes: PenStroke[], texts: TextNote[]) => { content = { strokes, texts }; changes++; } }); }
  function handlers() { return find(render(), (e) => e.type === "svg")!.props as Record<string, (e: unknown) => void>; }
  const event = (x: number, y: number, pointerId = 1) => ({ clientX: x * 600, clientY: y * 800, pointerId, button: 0, isPrimary: true,
    preventDefault() {}, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 800 }), setPointerCapture() {}, closest: () => null } });
  function select() {
    handlers().onPointerDown(event(.1, .1));
    for (const p of [[.5, .1], [.5, .6], [.1, .6]]) handlers().onPointerMove(event(...p as [number, number]));
    handlers().onPointerUp(event(.1, .1));
  }
  function click(label: string) {
    const button = find(render(), (e) => e.type === "button" && e.props.children === label)!;
    assert.ok(!button.props.disabled, label); (button.props.onClick as () => void)();
  }
  return { render, handlers, event, select, click, interaction, get: () => content, changes: () => changes,
    disable: () => { disabled = true; }, replace: () => { content = { ...content, strokes: [...content.strokes] }; } };
}

test("選択だけでは保存せず、混在オブジェクトの移動完了で一度だけ更新", () => {
  const f = fixture(); f.select(); assert.equal(f.changes(), 0);
  f.handlers().onPointerDown(f.event(.25, .25)); f.handlers().onPointerMove(f.event(.35, .35)); assert.equal(f.changes(), 0);
  f.handlers().onPointerUp(f.event(.35, .35)); assert.equal(f.changes(), 1);
  assert.ok(Math.abs(f.get().texts[0].x - .3) < 1e-8); assert.ok(Math.abs(f.get().strokes[0].points[0].x - .3) < 1e-8);
});

test("二本指ジェスチャー・pointercancel・lostcaptureでは移動を保存しない", () => {
  for (const kind of ["multi", "cancel", "lost"]) {
    states = []; refs = []; const f = fixture(); f.select(); const before = f.get();
    f.handlers().onPointerDown(f.event(.25, .25)); f.handlers().onPointerMove(f.event(.35, .35));
    if (kind === "multi") { f.interaction.blocked = true; f.interaction.cancellations.forEach((cancel) => cancel()); }
    else f.handlers()[kind === "cancel" ? "onPointerCancel" : "onLostPointerCapture"](f.event(.35, .35));
    f.handlers().onPointerUp(f.event(.35, .35)); assert.equal(f.changes(), 0); assert.equal(f.get(), before);
  }
});

test("操作途中のUndo相当の更新・無効化は古い選択の確定を拒否", () => {
  const f = fixture(); f.select(); f.handlers().onPointerDown(f.event(.25, .25)); f.replace();
  f.handlers().onPointerUp(f.event(.35, .35)); assert.equal(f.changes(), 0);
  f.disable(); f.handlers().onPointerDown(f.event(.1, .1)); f.handlers().onPointerUp(f.event(.5, .5)); assert.equal(f.changes(), 0);
});

test("ボタンで混在コピーを貼り付け、新しい付箋IDで選択し、解除でデータを変更しない", () => {
  const f = fixture(); f.select(); f.click("コピー"); assert.equal(f.changes(), 0);
  f.click("貼り付け"); assert.equal(f.changes(), 1); assert.equal(f.get().strokes.length, 2); assert.equal(f.get().texts.length, 2);
  assert.notEqual(f.get().texts[0].id, f.get().texts[1].id);
  f.click("選択解除"); assert.equal(f.changes(), 1);
});
