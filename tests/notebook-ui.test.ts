import assert from "node:assert/strict";
import test from "node:test";
import { createElement, isValidElement, Children, type ReactNode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NotebookActionDialog, type NotebookAction } from "@/features/pdf-editor/components/NotebookActionDialog";
import { NotebookTree, type NotebookTreeProps } from "@/features/pdf-editor/components/NotebookTree";
import { buildNoteTree } from "@/features/pdf-editor/noteTree";
import type { NoteLibrary } from "@/features/pdf-editor/types";

const library: NoteLibrary = {
  foldersEnabled: true,
  folders: [
    { id: "year", name: "2026", parentId: null },
    { id: "subject", name: "情報", parentId: "year" },
    { id: "other", name: "2027", parentId: null },
  ],
  notes: [{ id: "note", title: "ノート1", fileName: "sample.pdf", updatedAt: "2026-10-12", folderId: "subject" }],
};

function dialog(action: NotebookAction, busy = false, error: string | null = null) {
  return renderToStaticMarkup(createElement(NotebookActionDialog, {
    action, library, busy, error, onClose: () => {}, onSubmit: async () => {},
  }));
}

test("フォルダ作成のダイアログは選んだ親を初期選択する", () => {
  const html = dialog({ kind: "create-folder", parentId: "subject" });
  assert.match(html, /<dialog[^>]*class="modal"/);
  assert.match(html, /value="subject" selected=""/);
  assert.match(html, /2026 \/ 情報/);
  assert.match(html, /キャンセル/);
});

test("ノート整理は元の名前・保存先を維持して表示する", () => {
  const html = dialog({ kind: "edit-note", note: library.notes[0] });
  assert.match(html, /value="ノート1"/);
  assert.match(html, /value="subject" selected=""/);
  assert.match(html, /ノート名・保存先/);
});

test("フォルダ移動は現在の場所を説明し、自己・子孫を候補にしない", () => {
  const html = dialog({ kind: "move-folder", folder: library.folders[0] });
  assert.match(html, /最上位（現在）/);
  assert.match(html, /別の移動先を選択してください。/);
  assert.match(html, /type="submit"[^>]*disabled=""/);
  assert.doesNotMatch(html, /option value="year"|option value="subject"/);
  assert.match(html, /option value="other"/);
  assert.doesNotMatch(html, /移動するフォルダ/);
});

test("子フォルダの移動では現在の親を残し、最上位も候補にする", () => {
  const html = dialog({ kind: "move-folder", folder: library.folders[1] });
  assert.match(html, /value="year" disabled="" selected=""/);
  assert.match(html, /2026（現在）/);
  assert.match(html, /option value="root">最上位/);
});

test("移動先が存在しない場合は別フォルダの作成を案内する", () => {
  const html = renderToStaticMarkup(createElement(NotebookActionDialog, {
    action: { kind: "move-folder", folder: library.folders[0] },
    library: { ...library, folders: library.folders.slice(0, 2) },
    busy: false, error: null, onClose: () => {}, onSubmit: async () => {},
  }));
  assert.match(html, /移動先がありません。先に別のフォルダを作成してください。/);
});

test("保存中はフォームを無効化し、失敗時の理由はダイアログに表示する", () => {
  const action: NotebookAction = { kind: "edit-note", note: library.notes[0] };
  const html = dialog(action, true);
  assert.match(html, /<input[^>]*disabled=""/);
  assert.match(html, /<select[^>]*disabled=""/);
  assert.match(html, /type="button"[^>]*disabled=""/);
  assert.match(html, /保存中…/);
  assert.match(dialog(action, false, "保存できませんでした。"), /role="alert">保存できませんでした。/);
});

function treeProps(overrides: Partial<NotebookTreeProps> = {}): NotebookTreeProps {
  return {
    tree: buildNoteTree(library.folders, library.notes), currentNoteId: "note", selected: null,
    disabled: false, expanded: new Set(["year", "subject"]), dragEnabled: true,
    dragging: null, dropTarget: null, onSelect: () => {}, onOpen: () => {}, onToggle: () => {},
    onDragStart: () => {}, onDragEnd: () => {}, onDragOver: () => {}, onDragLeave: () => {}, onDrop: () => {},
    ...overrides,
  };
}

test("一覧は名前を直接操作でき、選択・移動先を強調する", () => {
  const html = renderToStaticMarkup(createElement(NotebookTree, treeProps({
    selected: { kind: "folder", id: "subject" }, dropTarget: "subject",
  })));
  assert.match(html, /bg-base-200/);
  assert.match(html, /outline-primary/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /draggable="true"/);
  assert.doesNotMatch(html, /このノートを表示|>開く</);
  const busyHtml = renderToStaticMarkup(createElement(NotebookTree, treeProps({ disabled: true })));
  assert.doesNotMatch(busyHtml, /draggable="true"/);
});

// 副作用なしのツリーについて、HTMLだけでなくイベントの接続先も確認する。
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    if (child.type === NotebookTree) return elements(NotebookTree(child.props as NotebookTreeProps));
    return [child, ...elements(child.props.children as ReactNode)];
  });
}

test("フォルダを選択でき、開いているノートは再読み込みしない", () => {
  const selected: unknown[] = [];
  const opened: unknown[] = [];
  const entries = elements(NotebookTree(treeProps({ onSelect: (item) => selected.push(item), onOpen: (note) => opened.push(note) })));
  const summary = entries.find((entry) => entry.type === "summary" && entry.props.children === "情報")!;
  (summary.props.onClick as (event: { preventDefault(): void }) => void)({ preventDefault() {} });
  const button = entries.find((entry) => entry.type === "button")!;
  (button.props.onClick as () => void)();
  assert.deepEqual(selected, [{ kind: "folder", id: "subject" }, { kind: "note", id: "note" }]);
  assert.deepEqual(opened, []);
});

test("別のノートを選ぶと読み込み、処理中のクリックでは選択しない", () => {
  let opened = 0;
  let selected = 0;
  const props = treeProps({ currentNoteId: null, onOpen: () => { opened++; }, onSelect: () => { selected++; } });
  const button = elements(NotebookTree(props)).find((entry) => entry.type === "button")!;
  (button.props.onClick as () => void)();
  assert.equal(opened, 1);
  assert.equal(selected, 1);
  const busy = elements(NotebookTree({ ...props, disabled: true }));
  (busy.find((entry) => entry.type === "button")!.props.onClick as () => void)();
  let prevented = false;
  (busy.find((entry) => entry.type === "summary")!.props.onClick as (event: { preventDefault(): void }) => void)({ preventDefault() { prevented = true; } });
  assert.equal(opened, 1);
  assert.equal(selected, 1);
  assert.equal(prevented, true);
});
