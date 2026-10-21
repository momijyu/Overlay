import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { buildNoteTree } from "@/features/pdf-editor/noteTree";
import type { NoteLibrary } from "@/features/pdf-editor/types";

// 一覧取得後の状態だけを代用し、用語変更で選択や整理対象が変わらないことを確認する。
let states: { value: unknown }[] = [];
let stateIndex = 0;
let library: NoteLibrary;
mock.module("react", { exports: {
  ...React,
  useEffect: () => {},
  useRef: (initial: unknown) => ({ current: initial }),
  useState: <T,>(initial: T | (() => T)) => {
    const index = stateIndex++;
    const slot = states[index] ??= { value: index === 1
      ? { key: "0:0", library, tree: buildNoteTree(library.folders, library.notes), error: null }
      : typeof initial === "function" ? (initial as () => T)() : initial };
    return [slot.value, (next: T | ((old: T) => T)) => {
      slot.value = typeof next === "function" ? (next as (old: T) => T)(slot.value as T) : next;
    }];
  },
} });
const { NotebookSidebar } = await import("@/features/pdf-editor/components/NotebookSidebar");
const { NotebookActionDialog } = await import("@/features/pdf-editor/components/NotebookActionDialog");
const { NotebookTree } = await import("@/features/pdf-editor/components/NotebookTree");

beforeEach(() => {
  states = []; stateIndex = 0;
  library = { foldersEnabled: true, folders: [{ id: "subject", name: "情報", parentId: null }],
    notes: [{ id: "note", title: "講義", fileName: "lecture.pdf", updatedAt: "2026-10-21", folderId: null }] };
});

function render() {
  stateIndex = 0;
  return NotebookSidebar({ refreshVersion: 0, currentNoteId: "note", disabled: false,
    onOpen: () => {}, onRenamed: () => {}, onDelete: async () => {}, onMutationChange: () => {} });
}

function find(node: React.ReactNode, match: (element: React.ReactElement<Record<string, unknown>>) => boolean): React.ReactElement<Record<string, unknown>> | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<Record<string, unknown>>(child)) continue;
    if (match(child)) return child;
    const found = find(child.props.children as React.ReactNode, match);
    if (found) return found;
  }
}

test("名前・フォルダのメニューは同じノートの整理を開き、所属表示もフォルダと表記する", () => {
  const node = render();
  assert.ok(find(node, (element) => element.type === "dt" && element.props.children === "開いているノートのフォルダ"));
  assert.ok(find(node, (element) => element.type === "dd" && element.props.children === "一番上"));
  const button = find(node, (element) => element.type === "button" && element.props.children === "名前・フォルダ")!;
  (button.props.onClick as () => void)();
  assert.deepEqual(find(render(), (element) => element.type === NotebookActionDialog)!.props.action,
    { kind: "edit-note", note: library.notes[0] });
});

test("一番上は一覧の絞り込みではなく作成先の選択として働き、開いているノートのフォルダを変えない", () => {
  library.notes[0].folderId = "subject";
  const node = render();
  const root = find(node, (element) => element.type === "button" && element.props["aria-label"] === "一番上")!;
  assert.equal(root.props.children, "一番上");
  (root.props.onClick as () => void)();
  const selected = render();
  assert.ok(find(selected, (element) => element.type === "dd" && element.props.children === "情報"));
  assert.deepEqual(find(selected, (element) => element.type === NotebookTree)!.props.tree,
    buildNoteTree(library.folders, library.notes));
  const create = find(selected, (element) => element.type === "button" && element.props.children === "フォルダ作成")!;
  (create.props.onClick as () => void)();
  assert.deepEqual(find(render(), (element) => element.type === NotebookActionDialog)!.props.action,
    { kind: "create-folder", parentId: null });
  assert.equal(library.notes[0].folderId, "subject");
});
