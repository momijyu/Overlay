import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { createLocalAutosave, type LocalSaveInput } from "@/features/pdf-editor/localAutosave";
import * as localNotes from "@/features/pdf-editor/localNotes";
import type { PenStroke, SavedNoteSummary } from "@/features/pdf-editor/types";

// Hooksの保持だけを代用し、Workspace内のイベント・状態・保存の接続を検証する。
// DOM・実際のReact再描画・ブラウザ操作を再現するテストではない。
const file = new File(["test"], "sample.pdf");
const pdf = { numPages: 3 };
let states: { value: unknown }[] = [];
let refs: { current: unknown }[] = [];
let stateCursor = 0;
let refCursor = 0;
let deleteFails = false;
let openFails = false;
const exported: Record<number, PenStroke[]>[] = [];
const openedStrokes = { 2: [{ width: 5, points: [{ x: 0.2, y: 0.3 }] }] };

mock.module("react", { exports: {
  ...React,
  useState: <T,>(initial: T | (() => T)) => {
    const slotIndex = stateCursor++;
    const slot = states[slotIndex] ??= {
      value: slotIndex === 0 ? file : slotIndex === 1 ? pdf
        : typeof initial === "function" ? (initial as () => T)() : initial,
    };
    return [slot.value, (next: T | ((previous: T) => T)) => {
      slot.value = typeof next === "function" ? (next as (previous: T) => T)(slot.value as T) : next;
    }];
  },
  useRef: (initial: unknown) => refs[refCursor++] ??= { current: initial },
  useEffect: () => {},
} });
mock.module("@/features/pdf-editor/localNotes", { exports: {
  ...localNotes,
  deleteSavedNote: async () => { if (deleteFails) throw new Error("削除失敗"); },
  loadLocalNote: async () => {
    if (openFails) throw new Error("読込失敗");
    return { file, id: "other", strokesByPage: openedStrokes, revision: 1 };
  },
} });
mock.module("pdfjs-dist/legacy/build/pdf.mjs", { exports: {
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve(pdf), destroy: async () => {} }),
} });
mock.module("@/features/pdf-editor/exportAnnotatedPdf", { exports: {
  exportAnnotatedPdf: async (_file: unknown, _pdf: unknown, strokes: Record<number, PenStroke[]>) => {
    exported.push(strokes);
    // 出力に渡すデータだけを確認し、DOMでのダウンロードは実行しない。
    throw new Error("テスト用の出力停止");
  },
} });
const { PdfWorkspace } = await import("@/features/pdf-editor/components/PdfWorkspace");
const { PdfPage } = await import("@/features/pdf-editor/components/PdfPage");
const { HistoryControls } = await import("@/features/pdf-editor/components/HistoryControls");
const { NotebookSidebar } = await import("@/features/pdf-editor/components/NotebookSidebar");

beforeEach(() => { states = []; refs = []; stateCursor = 0; refCursor = 0; deleteFails = false; openFails = false; exported.length = 0; });

function render() {
  stateCursor = 0;
  refCursor = 0;
  return PdfWorkspace();
}

function find(node: React.ReactNode, predicate: (element: React.ReactElement) => boolean): React.ReactElement | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) continue;
    if (predicate(child)) return child;
    const result = find(child.props.children, predicate);
    if (result) return result;
  }
}

function props<T>(type: (props: T) => React.ReactNode): T {
  return find(render(), (element) => element.type === type)!.props as T;
}

function setup() {
  render();
  refs[0].current = true; // mountedRef（useEffectの代用）
  const calls: LocalSaveInput[] = [];
  const autosave = createLocalAutosave({
    file, noteId: "existing", strokesByPage: {},
    persist: async (input) => { calls.push(input); return "existing"; }, onChange: () => {},
  });
  refs[3].current = autosave;
  return { calls, autosave };
}

const red: PenStroke = { width: 2.5, color: "#ff0000", points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] };

test("画面の描画・消去・Undo・Redoが同じ履歴と自動保存へ接続される", async () => {
  const { autosave, calls } = setup();
  assert.equal(props(HistoryControls).canUndo, false);
  props(PdfPage).onStrokeComplete(red);
  await autosave.flush();
  assert.equal(props(HistoryControls).canUndo, true);
  assert.equal(props(HistoryControls).canRedo, false);
  props(PdfPage).onStrokesChange([]);
  await autosave.flush();
  const version = props(PdfPage).editVersion;
  props(HistoryControls).onUndo();
  await autosave.flush();
  assert.deepEqual(props(PdfPage).strokes, [red]);
  assert.ok(props(PdfPage).editVersion > version);
  props(HistoryControls).onUndo();
  await autosave.flush();
  assert.deepEqual(props(PdfPage).strokes, []);
  assert.equal(props(HistoryControls).canUndo, false);
  props(HistoryControls).onRedo();
  await autosave.flush();
  assert.deepEqual(props(PdfPage).strokes, [red]);
  props(HistoryControls).onRedo();
  await autosave.flush();
  assert.deepEqual(props(PdfPage).strokes, []);
  assert.deepEqual(calls.at(-1)!.strokesByPage, { 1: [] });
});

test("別ページでのUndoは対象ページを表示し、新規描画でRedoを無効化する", () => {
  setup();
  props(PdfPage).onStrokeComplete(red);
  const next = find(render(), (element) => element.type === "button" && (element.props as { children?: string }).children === "次へ")!;
  (next.props as { onClick: () => void }).onClick();
  assert.equal(props(PdfPage).pageNumber, 2);
  props(PdfPage).onStrokeComplete(red);
  const previous = find(render(), (element) => element.type === "button" && (element.props as { children?: string }).children === "前へ")!;
  (previous.props as { onClick: () => void }).onClick();
  assert.equal(props(PdfPage).pageNumber, 1);
  props(HistoryControls).onUndo();
  assert.equal(props(PdfPage).pageNumber, 2);
  assert.deepEqual(props(PdfPage).strokes, []);
  assert.equal(props(HistoryControls).canRedo, true);
  props(PdfPage).onStrokeComplete({ ...red, color: "#0000ff" });
  assert.equal(props(HistoryControls).canRedo, false);
});

test("整理中のUndoを拒否し、整理後のPDF出力には取り消し後の現在値を渡す", async () => {
  setup();
  props(PdfPage).onStrokeComplete(red);
  const undo = props(HistoryControls).onUndo;
  props(NotebookSidebar).onMutationChange(true);
  assert.equal(props(HistoryControls).disabled, true);
  undo();
  assert.deepEqual(props(PdfPage).strokes, [red]);
  props(NotebookSidebar).onMutationChange(false);
  props(HistoryControls).onUndo();
  const download = find(render(), (element) => element.type === "button" && (element.props as { children?: string }).children === "PDFをダウンロード")!;
  (download.props as { onClick: () => void }).onClick();
  await new Promise(setImmediate);
  assert.deepEqual(exported, [{}]);
});

test("ノート削除に失敗した場合は履歴を残し、成功後に内容と履歴を初期化する", async () => {
  setup();
  props(PdfPage).onStrokeComplete(red);
  deleteFails = true;
  await assert.rejects(props(NotebookSidebar).onDelete("existing"), /削除失敗/);
  assert.equal(props(HistoryControls).canUndo, true);
  assert.deepEqual(props(PdfPage).strokes, [red]);
  deleteFails = false;
  await props(NotebookSidebar).onDelete("existing");
  assert.equal(find(render(), (element) => element.type === PdfPage), undefined);
  assert.equal(find(render(), (element) => element.type === HistoryControls), undefined);
  assert.deepEqual((refs[4].current as { past: unknown[]; future: unknown[] }).past, []);
});

test("読み込み失敗時は履歴を保持し、別ノートを開けた時だけリセットする", async () => {
  setup();
  props(PdfPage).onStrokeComplete(red);
  const summary = { id: "other", title: "別ノート" } as SavedNoteSummary;
  const waitOpen = async () => {
    for (let i = 0; i < 20 && refs[1].current; i++) await new Promise(setImmediate);
    assert.equal(refs[1].current, false);
  };
  openFails = true;
  props(NotebookSidebar).onOpen(summary);
  await waitOpen();
  assert.equal(props(HistoryControls).canUndo, true);
  assert.deepEqual(props(PdfPage).strokes, [red]);
  openFails = false;
  props(NotebookSidebar).onOpen(summary);
  await waitOpen();
  assert.equal(props(NotebookSidebar).currentNoteId, "other");
  assert.equal(props(HistoryControls).canUndo, false);
  assert.equal(props(HistoryControls).canRedo, false);
  assert.equal(props(PdfPage).pageNumber, 1);
});
