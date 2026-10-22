import assert from "node:assert/strict";
import test from "node:test";
import { checkedDeletion, toggleNotebookSelection } from "@/features/pdf-editor/noteSelection";
import { libraryItems, noteItemKey } from "@/features/pdf-editor/noteDrag";
import type { NoteLibrary } from "@/features/pdf-editor/types";

const library: NoteLibrary = { foldersEnabled: true,
  folders: [{ id: "parent", name: "親", parentId: null }, { id: "child", name: "子", parentId: "parent" },
    { id: "sibling", name: "兄弟", parentId: "parent" }, { id: "outside", name: "外", parentId: null }],
  notes: [{ id: "inside", title: "中", folderId: "child", fileName: "test.pdf", updatedAt: "2026-10-22" },
    { id: "sibling-note", title: "兄弟のノート", folderId: "sibling", fileName: "test.pdf", updatedAt: "2026-10-22" },
    { id: "root", title: "ルート", folderId: null, fileName: "test.pdf", updatedAt: "2026-10-22" }] };

test("フォルダを選ぶと閉じた子孫のフォルダとノートを全てチェックし、元のSetは変更しない", () => {
  const original = new Set(["note:root"]);
  const next = toggleNotebookSelection(original, { kind: "folder", id: "parent" }, library);
  assert.deepEqual([...next].sort(), ["folder:parent", "folder:child", "folder:sibling", "note:inside", "note:sibling-note", "note:root"].sort());
  assert.deepEqual([...original], ["note:root"]);
  assert.equal(next.has("folder:outside"), false);
});

test("子ノートを外すと祖先のチェックも全て外し、兄弟の選択は維持する", () => {
  const all = new Set(libraryItems(library).map(noteItemKey));
  const next = toggleNotebookSelection(all, { kind: "note", id: "inside" }, library);
  for (const key of ["folder:parent", "folder:child", "note:inside"]) assert.equal(next.has(key), false);
  for (const key of ["folder:sibling", "note:sibling-note", "folder:outside", "note:root"]) assert.equal(next.has(key), true);
});

test("子フォルダを外すとその中身と祖先を解除する。親を外しても選択の残骸を作らない", () => {
  const all = new Set(libraryItems(library).map(noteItemKey));
  const childOff = toggleNotebookSelection(all, { kind: "folder", id: "child" }, library);
  assert.equal(childOff.has("folder:parent"), false);
  assert.equal(childOff.has("folder:child"), false);
  assert.equal(childOff.has("note:inside"), false);
  assert.equal(childOff.has("note:sibling-note"), true);
  const parentOff = toggleNotebookSelection(all, { kind: "folder", id: "parent" }, library);
  assert.deepEqual([...parentOff].sort(), ["folder:outside", "note:root"]);
});

test("子を選び直しても祖先を勝手にチェックせず、親の再選択で中身をそろえる", () => {
  const selected = toggleNotebookSelection(new Set(), { kind: "note", id: "inside" }, library);
  assert.deepEqual([...selected], ["note:inside"]);
  const parentOn = toggleNotebookSelection(selected, { kind: "folder", id: "parent" }, library);
  assert.equal(parentOn.size, 5);
  assert.equal(checkedDeletion(libraryItems(library).filter((item) => parentOn.has(noteItemKey(item))), library).length, 5);
});

test("削除確認は空・消えた対象・未選択の子があるフォルダを拒否し、対象を暗黙に増やさない", () => {
  assert.throws(() => checkedDeletion([], library), /削除対象が変更/);
  assert.throws(() => checkedDeletion([{ kind: "note", id: "missing" }], library), /削除対象が変更/);
  assert.throws(() => checkedDeletion([{ kind: "folder", id: "parent" }], library), /中身が選択内容と異なります/);
  assert.deepEqual(checkedDeletion([{ kind: "note", id: "inside" }], library), [{ kind: "note", id: "inside" }]);
});

test("不明な項目の選択では既存の選択だけ残し、壊れた循環でも無限ループしない", () => {
  assert.deepEqual(toggleNotebookSelection(new Set(["note:root", "note:missing"]), { kind: "note", id: "missing" }, library), new Set(["note:root"]));
  const cyclic = { ...library, folders: [{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }] };
  const selected = toggleNotebookSelection(new Set(), { kind: "folder", id: "a" }, cyclic);
  assert.equal(selected.size, 2);
  assert.equal(toggleNotebookSelection(selected, { kind: "folder", id: "b" }, cyclic).size, 0);
});
