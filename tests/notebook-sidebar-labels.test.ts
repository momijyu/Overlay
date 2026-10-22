import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { buildNoteTree } from "@/features/pdf-editor/noteTree";
import type { NoteLibrary } from "@/features/pdf-editor/types";
import { IDBFactory } from "fake-indexeddb";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
import { deleteSavedItems } from "@/features/pdf-editor/localNotes";

// 一覧取得後の状態だけを代用し、用語変更で選択や整理対象が変わらないことを確認する。
let states: { value: unknown }[] = [];
let stateIndex = 0;
let library: NoteLibrary;
mock.module("react", { exports: {
  ...React,
  useEffect: (effect: () => void, dependencies?: unknown[]) => { if (dependencies?.length === 0) effect(); },
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
const { NotebookMoveDialog } = await import("@/features/pdf-editor/components/NotebookMoveDialog");
const { NotebookDeleteDialog } = await import("@/features/pdf-editor/components/NotebookDeleteDialog");

beforeEach(() => {
  states = []; stateIndex = 0;
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  library = { foldersEnabled: true, folders: [{ id: "subject", name: "情報", parentId: null }],
    notes: [{ id: "note", title: "講義", fileName: "lecture.pdf", updatedAt: "2026-10-21", folderId: null }] };
});

function clickText(node: React.ReactNode, label: string) {
  const button = find(node, (element) => element.type === "button" && element.props.children === label)!;
  assert.ok(button, label);
  assert.equal(button.props.disabled, false);
  (button.props.onClick as () => void)();
}

test("選択モードの全選択・解除・終了と一括移動を同じ一覧へ接続する", async () => {
  await withLocalTransaction(["notes", "folders"], "readwrite", async (tx) => {
    for (const folder of library.folders) await readRequest(tx.objectStore("folders").put(folder));
    for (const note of library.notes) await readRequest(tx.objectStore("notes").put({ ...note, strokesByPage: {} }));
  });
  clickText(render(), "選択");
  let node = render();
  assert.equal(find(node, (element) => element.type === NotebookTree)!.props.selectionMode, true);
  assert.equal(find(node, (element) => element.type === NotebookTree)!.props.dragEnabled, false);
  assert.equal(find(node, (element) => element.type === "summary" && element.props.children === "操作"), undefined);
  clickText(node, "全選択");
  assert.equal((find(render(), (element) => element.type === NotebookTree)!.props.checkedItems as Set<string>).size, 2);
  clickText(render(), "選択解除");
  assert.equal((find(render(), (element) => element.type === NotebookTree)!.props.checkedItems as Set<string>).size, 0);
  const tree = find(render(), (element) => element.type === NotebookTree)!;
  (tree.props.onCheck as (item: { kind: string; id: string }) => void)({ kind: "note", id: "note" });
  clickText(render(), "移動");
  node = render();
  const dialog = find(node, (element) => element.type === NotebookMoveDialog)!;
  assert.deepEqual(dialog.props.items, [{ kind: "note", id: "note" }]);
  await (dialog.props.onSubmit as (id: string) => Promise<void>)("subject");
  node = render();
  assert.ok(find(node, (element) => element.type === "button" && element.props.children === "選択"));
  assert.equal(find(node, (element) => element.type === NotebookMoveDialog), undefined);
  const note = await withLocalTransaction(["notes"], "readonly", (tx) => readRequest<{ folderId: string }>(tx.objectStore("notes").get("note")));
  assert.equal(note.folderId, "subject");
});

test("一括移動のキャンセルと保存失敗では選択を残し、終了で解除する", async () => {
  clickText(render(), "選択");
  const tree = find(render(), (element) => element.type === NotebookTree)!;
  (tree.props.onCheck as (item: { kind: string; id: string }) => void)({ kind: "note", id: "note" });
  clickText(render(), "移動");
  let dialog = find(render(), (element) => element.type === NotebookMoveDialog)!;
  (dialog.props.onClose as () => void)();
  assert.equal(find(render(), (element) => element.type === NotebookMoveDialog), undefined);
  clickText(render(), "移動");
  dialog = find(render(), (element) => element.type === NotebookMoveDialog)!;
  // 表示後、別タブで対象が消えた状況。空のテストDBなので保存時の再検証が失敗する。
  await (dialog.props.onSubmit as (id: string) => Promise<void>)("subject");
  dialog = find(render(), (element) => element.type === NotebookMoveDialog)!;
  assert.match(dialog.props.error as string, /移動できません/);
  assert.deepEqual(dialog.props.items, [{ kind: "note", id: "note" }]);
  (dialog.props.onClose as () => void)();
  clickText(render(), "選択終了");
  assert.equal((find(render(), (element) => element.type === NotebookTree)!.props.checkedItems as Set<string>).size, 0);
});

test("フォルダ選択で子にチェックし、子を外すと親も解除して他のチェックは維持する", () => {
  library.notes[0].folderId = "subject";
  library.notes.push({ ...library.notes[0], id: "second", title: "別ノート" });
  clickText(render(), "選択");
  const check = (item: { kind: string; id: string }) => {
    (find(render(), (element) => element.type === NotebookTree)!.props.onCheck as (item: { kind: string; id: string }) => void)(item);
  };
  check({ kind: "folder", id: "subject" });
  assert.deepEqual(find(render(), (element) => element.type === NotebookTree)!.props.checkedItems,
    new Set(["folder:subject", "note:note", "note:second"]));
  check({ kind: "note", id: "note" });
  assert.deepEqual(find(render(), (element) => element.type === NotebookTree)!.props.checkedItems, new Set(["note:second"]));
});

test("一括削除は確認を開くだけでは消さず、キャンセル・失敗時に選択を維持する", async () => {
  clickText(render(), "選択");
  clickText(render(), "全選択");
  clickText(render(), "削除");
  let dialog = find(render(), (element) => element.type === NotebookDeleteDialog)!;
  assert.equal((dialog.props.items as unknown[]).length, 2);
  (dialog.props.onClose as () => void)();
  assert.equal(find(render(), (element) => element.type === NotebookDeleteDialog), undefined);
  assert.equal((find(render(), (element) => element.type === NotebookTree)!.props.checkedItems as Set<string>).size, 2);
  clickText(render(), "削除");
  dialog = find(render(), (element) => element.type === NotebookDeleteDialog)!;
  await (dialog.props.onSubmit as () => Promise<void>)(); // テストDBに対象がなく失敗。
  dialog = find(render(), (element) => element.type === NotebookDeleteDialog)!;
  assert.match(dialog.props.error as string, /削除対象が変更/);
  assert.equal((dialog.props.items as unknown[]).length, 2);
});

test("確認した一括削除だけを実行し、成功後に一覧を更新して選択を解除する", async () => {
  await withLocalTransaction(["notes", "folders"], "readwrite", async (tx) => {
    for (const folder of library.folders) await readRequest(tx.objectStore("folders").put(folder));
    for (const note of library.notes) await readRequest(tx.objectStore("notes").put({ ...note, strokesByPage: {} }));
  });
  clickText(render(), "選択");
  clickText(render(), "全選択");
  clickText(render(), "削除");
  const before = await withLocalTransaction(["notes"], "readonly", (tx) => readRequest(tx.objectStore("notes").count()));
  assert.equal(before, 1);
  const dialog = find(render(), (element) => element.type === NotebookDeleteDialog)!;
  await (dialog.props.onSubmit as () => Promise<void>)();
  assert.equal(find(render(), (element) => element.type === NotebookDeleteDialog), undefined);
  assert.ok(find(render(), (element) => element.type === "button" && element.props.children === "選択"));
  const after = await withLocalTransaction(["notes", "folders"], "readonly", async (tx) => Promise.all([
    readRequest(tx.objectStore("notes").count()), readRequest(tx.objectStore("folders").count()),
  ]));
  assert.deepEqual(after, [0, 0]);
});

function render() {
  stateIndex = 0;
  return NotebookSidebar({ refreshVersion: 0, currentNoteId: "note", disabled: false,
    onOpen: () => {}, onRenamed: () => {}, onDelete: async () => {}, onDeleteItems: deleteSavedItems, onMutationChange: () => {} });
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
