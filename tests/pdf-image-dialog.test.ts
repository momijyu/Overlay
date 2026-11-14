import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import * as React from "react";
import type { ImportedPdfImage } from "@/features/pdf-editor/pdfImageImport";
import { testPng } from "./image-fixture";

let states: unknown[] = [], refs: { current: unknown }[] = [];
let stateIndex = 0, refIndex = 0, effectIndex = 0;
let effects: (() => void)[] = [];
let slots: { deps?: unknown[]; cleanup?: () => void }[] = [];
let memoIndex = 0;
let memos: { deps: unknown[]; value: unknown }[] = [];
function effect(callback: () => void | (() => void), deps?: unknown[]) {
  const index = effectIndex++, previous = slots[index];
  if (deps && previous?.deps && deps.length === previous.deps.length && deps.every((dep, i) => Object.is(dep, previous.deps![i]))) return;
  effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() || undefined }; });
}
mock.module("react", { exports: { ...React,
  useState(initial: unknown) {
    const index = stateIndex++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (next: unknown) => { states[index] = next; }];
  },
  useRef(initial: unknown) { return refs[refIndex++] ??= { current: initial }; },
  useId: () => "image-test",
  useMemo(callback: () => unknown, deps: unknown[]) {
    const index = memoIndex++, previous = memos[index];
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) memos[index] = { deps, value: callback() };
    return memos[index].value;
  },
  useEffect: effect, useLayoutEffect: effect,
} });
mock.module("react-dom", { exports: { createPortal: (children: React.ReactNode) => children } });

let destroyed = 0;
const pdf = { numPages: 3, loadingTask: { destroy: async () => { destroyed++; } } };
let requests: { page: number; signal: AbortSignal; resolve(value: ImportedPdfImage): void }[] = [];
mock.module("@/features/pdf-editor/pdfImageImport", { exports: {
  openPdfForImage: async () => pdf,
  renderPdfImage: (_pdf: unknown, page: number, signal: AbortSignal) => new Promise<ImportedPdfImage>((resolve) => { requests.push({ page, signal, resolve }); }),
} });
const { PdfImageDialog } = await import("@/features/pdf-editor/components/PdfImageDialog");
beforeEach(() => { states = []; refs = []; slots = []; effects = []; memos = []; requests = []; destroyed = 0; });
afterEach(() => slots.forEach((slot) => slot.cleanup?.()));
function find(node: React.ReactNode, predicate: (element: React.ReactElement) => boolean): React.ReactElement | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) continue;
    if (predicate(child)) return child;
    const result = find(child.props.children, predicate); if (result) return result;
  }
}
function fixture() {
  let closed = 0;
  const inserted: ImportedPdfImage[] = [];
  const props = { file: new File(["%PDF"], "資料.pdf"), onClose: () => { closed++; }, onInsert: (value: ImportedPdfImage) => { inserted.push(value); } };
  function render() {
    stateIndex = refIndex = effectIndex = memoIndex = 0; effects = [];
    const tree = PdfImageDialog(props);
    refs[0].current = { showModal() {}, close() {}, open: true };
    for (const callback of effects) callback();
    return tree;
  }
  function button(label: string) { return find(render(), (e) => e.type === "button" && ((e.props as React.ComponentProps<"button">).children === label || (e.props as React.ComponentProps<"button">)["aria-label"] === label))!.props as React.ComponentProps<"button">; }
  return { render, button, inserted, props, closed: () => closed };
}
const image: ImportedPdfImage = { id: "a".repeat(64), asset: { blob: testPng(), width: 2, height: 2 } };
async function flush() { await Promise.resolve(); await Promise.resolve(); }

test("ページ切替中は追加を止め、遅れて完了した前ページを採用せず、最新ページだけ確定する", async () => {
  const f = fixture(); f.render(); await flush(); f.render();
  assert.equal(f.button("追加").disabled, true);
  assert.equal(requests[0].page, 1);
  f.button("次のページ").onClick!({} as React.MouseEvent<HTMLButtonElement>); f.render();
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve(image); await flush();
  assert.equal(f.button("追加").disabled, true);
  requests[1].resolve(image); await flush();
  assert.equal(f.button("追加").disabled, false);
  f.button("追加").onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.equal(f.inserted.length, 1);
  f.button("前のページ").onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.equal(f.button("追加").disabled, true, "戻ったページの失効済みプレビューを再利用しない");
});

test("変換中もキャンセルでき、閉じると変換とPDFの接続を解放する", async () => {
  const f = fixture(); f.render(); await flush(); f.render();
  assert.equal(f.button("キャンセル").disabled, undefined);
  f.button("キャンセル").onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.equal(f.closed(), 1);
  slots.forEach((slot) => slot.cleanup?.()); slots = [];
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(destroyed, 1); assert.equal(f.inserted.length, 0);
});

test("ノート全体の画像上限などの確定失敗を表示し、内容を勝手に閉じない", async () => {
  const f = fixture(); f.props.onInsert = () => { throw new Error("画像の容量上限です。"); };
  f.render(); await flush(); f.render(); requests[0].resolve(image); await flush();
  f.button("追加").onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.ok(find(f.render(), (e) => (e.props as React.ComponentProps<"p">).role === "alert"));
  assert.equal(f.closed(), 0); assert.equal(f.button("追加").disabled, true);
});
