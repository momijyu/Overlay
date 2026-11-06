import assert from "node:assert/strict";
import { test } from "node:test";

import { buildNoteTree, folderChoices, hasFolderNameConflict } from "@/features/pdf-editor/noteTree";
import { canMoveItem, readNoteDrag } from "@/features/pdf-editor/noteDrag";
import type { NoteFolder, SavedNoteSummary } from "@/features/pdf-editor/types";

const summary = (id: string, folderId: string | null, title = id): SavedNoteSummary => ({
  id, folderId, title, fileName: `${id}.pdf`, updatedAt: "2026-10-01T00:00:00Z",
});

test("同名フォルダへのドラッグは最上位・子階層とも大文字小文字を区別せず無効", () => {
  const library = { foldersEnabled: true, notes: [summary("note", "parent", "Docs")], folders: [
    { id: "parent", name: "2026", parentId: null },
    { id: "destination", name: "2027", parentId: null },
    { id: "moving", name: "Docs", parentId: "parent" },
    { id: "root-copy", name: "docs", parentId: null },
    { id: "child-copy", name: "DOCS", parentId: "destination" },
  ] };
  const item = { kind: "folder" as const, id: "moving" };
  assert.equal(canMoveItem(item, null, library), false);
  assert.equal(canMoveItem(item, "destination", library), false);
  assert.equal(canMoveItem(item, "root-copy", library), true, "別階層の同名は許可");
  assert.equal(canMoveItem({ kind: "note", id: "note" }, "destination", library), true, "ノート名は制限しない");
  assert.equal(hasFolderNameConflict(" Docs ", "parent", library, "moving"), false, "自身を重複としない");
});

test("2026→情報→ノート1のツリーと保存先のパスを作る", () => {
  const folders: NoteFolder[] = [
    { id: "info", name: "情報", parentId: "year" },
    { id: "year", name: "2026", parentId: null },
  ];
  const notes = [summary("note", "info", "ノート1")];
  const originals = structuredClone({ folders, notes });
  const tree = buildNoteTree(folders, notes);
  assert.equal(tree.folders[0].folders[0].notes[0].title, "ノート1");
  assert.deepEqual(folderChoices(tree), [{ id: "year", path: "2026" }, { id: "info", path: "2026 / 情報" }]);
  assert.deepEqual({ folders, notes }, originals, "入力を破壊しない");
});

test("未分類ノートと親がない項目を最上位へ表示し、名前順に並べる", () => {
  const tree = buildNoteTree([{ id: "orphan", name: "情報", parentId: "missing" }],
    [summary("b", null), summary("a", "missing")]);
  assert.equal(tree.folders[0].id, "orphan");
  assert.deepEqual(tree.notes.map((note) => note.id), ["a", "b"]);
});

test("重複・自己参照・循環したフォルダは無限再帰せずエラーにする", () => {
  const folder = { id: "a", name: "a", parentId: null };
  assert.throws(() => buildNoteTree([folder, folder], []), /重複/);
  assert.throws(() => buildNoteTree([{ ...folder, parentId: "a" }], []), /循環/);
  assert.throws(() => buildNoteTree([{ ...folder, parentId: "b" }, { id: "b", name: "b", parentId: "a" }], []), /循環/);
});

test("ドラッグデータはノート・フォルダのIDだけ受け入れ、不正な文字列を断る", () => {
  assert.deepEqual(readNoteDrag('{"kind":"note","id":"a"}'), { kind: "note", id: "a" });
  assert.deepEqual(readNoteDrag('{"kind":"folder","id":"a"}'), { kind: "folder", id: "a" });
  for (const value of ["", "授業.pdf", "null", "[]", "{}", '{"kind":"file","id":"a"}', '{"kind":"note","id":1}', '{"kind":"note","id":""}']) {
    assert.equal(readNoteDrag(value), null);
  }
});

test("移動先候補は自己・子孫・現在の場所・不明な項目を除き、最上位への移動を許す", () => {
  const library = {
    foldersEnabled: true,
    folders: [
      { id: "year", name: "2026", parentId: null },
      { id: "info", name: "情報", parentId: "year" },
      { id: "sub", name: "演習", parentId: "info" },
      { id: "other", name: "2027", parentId: null },
    ],
    notes: [summary("a", null), summary("b", "info")],
  };
  assert(canMoveItem({ kind: "note", id: "a" }, "info", library));
  assert(!canMoveItem({ kind: "note", id: "a" }, null, library));
  assert(!canMoveItem({ kind: "note", id: "b" }, "info", library));
  assert(canMoveItem({ kind: "note", id: "b" }, null, library));
  assert(!canMoveItem({ kind: "folder", id: "year" }, "year", library));
  assert(!canMoveItem({ kind: "folder", id: "year" }, "sub", library));
  assert(!canMoveItem({ kind: "folder", id: "info" }, "year", library));
  assert(canMoveItem({ kind: "folder", id: "info" }, null, library));
  assert(canMoveItem({ kind: "folder", id: "info" }, "other", library));
  assert(!canMoveItem({ kind: "note", id: "missing" }, "info", library));
  assert(!canMoveItem({ kind: "note", id: "a" }, "missing", library));
  assert(!canMoveItem({ kind: "folder", id: "missing" }, null, library));
  assert(!canMoveItem({ kind: "note", id: "a" }, "info", { ...library, foldersEnabled: false }));
  const cyclic = { ...library, folders: [{ id: "a", name: "a", parentId: "b" }, { id: "b", name: "b", parentId: "a" }, library.folders[1]] };
  assert(!canMoveItem({ kind: "folder", id: "info" }, "a", cyclic));
});
