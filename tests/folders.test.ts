import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

import { buildNoteTree, canDeleteEmptyFolder, folderChoices, hasFolderNameConflict } from "@/features/pdf-editor/noteTree";
import { canMoveItem, readNoteDrag } from "@/features/pdf-editor/noteDrag";
import type { NoteFolder, SavedNoteSummary } from "@/features/pdf-editor/types";

type Row = {
  id: string;
  owner_id: string;
  name?: string;
  parent_id?: string | null;
  title?: string | null;
  folder_id?: string | null;
  file_name?: string;
  updated_at?: string;
  strokes_by_page?: unknown;
  pdf_path?: string;
};
function freshStore() {
  return {
    ownerId: "owner-a" as string | null,
    tables: { notes: [] as Row[], note_folders: [] as Row[] },
    schemaReady: true,
    movesReady: true,
    managementReady: true,
    managementCalls: [] as { name: string; folderId: string; newName?: string }[],
    failure: false,
    signIns: 0,
    columns: [] as string[],
    moves: [] as { folderId: string; parentId: string | null }[],
  };
}
let store = freshStore();

// フォルダ機能も仮のAPIで検証する。実際のSupabaseには接続しない。
class Query {
  filters = new Map<string, string>();
  inserted: Row | null = null;
  updated: Partial<Row> | null = null;
  private table: keyof typeof store.tables;
  constructor(table: keyof typeof store.tables) { this.table = table; }
  select(columns: string) { store.columns.push(columns); return this; }
  eq(key: string, value: string) { this.filters.set(key, value); return this; }
  order() { return this; }
  overrideTypes() { return this; }
  insert(value: Row) { this.inserted = value; return this; }
  update(value: Partial<Row>) { this.updated = value; return this; }
  execute(single: boolean) {
    const fail = (code: string) => ({ data: null, error: { code } });
    if (!store.schemaReady && this.table === "note_folders") return fail("PGRST205");
    if (store.failure) return fail("NETWORK");
    if (this.inserted) {
      const row = this.inserted;
      if (row.owner_id !== store.ownerId) return fail("42501");
      if (row.parent_id && !store.tables.note_folders.some((parent) =>
        parent.id === row.parent_id && parent.owner_id === row.owner_id)) return fail("23503");
      if (store.tables.note_folders.some((existing) =>
        existing.owner_id === row.owner_id && existing.parent_id === row.parent_id &&
        existing.name?.toLowerCase() === row.name?.toLowerCase())) return fail("23505");
      store.tables[this.table].push(row);
    }
    const rows = store.tables[this.table].filter((row) =>
      row.owner_id === store.ownerId &&
      [...this.filters].every(([key, value]) => row[key as keyof Row] === value));
    if (this.updated) {
      const folderId = this.updated.folder_id;
      if (folderId && !store.tables.note_folders.some((folder) =>
        folder.id === folderId && folder.owner_id === store.ownerId)) return fail("23503");
      rows.forEach((row) => Object.assign(row, this.updated));
    }
    if (single && rows.length !== 1) return fail("PGRST116");
    return { data: single ? rows[0] : rows, error: null };
  }
  single() { return Promise.resolve(this.execute(true)); }
  then(resolve: (value: ReturnType<Query["execute"]>) => unknown) {
    return Promise.resolve(this.execute(false)).then(resolve);
  }
}

mock.module("@/lib/supabase/client", {
  exports: {
    getSupabaseClient: () => ({
      auth: {
        async getSession() {
          return { data: { session: store.ownerId ? { user: { id: store.ownerId } } : null }, error: null };
        },
        async signInAnonymously() {
          store.signIns++;
          store.ownerId = "new-owner";
          return { data: { user: { id: store.ownerId } }, error: null };
        },
      },
      from(table: keyof typeof store.tables) { return new Query(table); },
      async rpc(name: string, args: { moving_folder_id?: string; destination_parent_id?: string | null; target_folder_id?: string; new_name?: string }) {
        if (name === "rename_note_folder" || name === "delete_empty_note_folder") {
          store.managementCalls.push({ name, folderId: args.target_folder_id!, newName: args.new_name });
          const fail = (code: string) => ({ data: null, error: { code } });
          if (!store.managementReady) return fail("PGRST202");
          if (store.failure) return fail("NETWORK");
          const folder = store.tables.note_folders.find((row) => row.id === args.target_folder_id && row.owner_id === store.ownerId);
          if (!folder) return fail("42501");
          if (name === "rename_note_folder") {
            if (store.tables.note_folders.some((row) => row.id !== folder.id && row.owner_id === store.ownerId
              && row.parent_id === folder.parent_id && row.name?.toLowerCase() === args.new_name?.toLowerCase())) return fail("23505");
            folder.name = args.new_name;
          } else {
            if (store.tables.note_folders.some((row) => row.parent_id === folder.id)
              || store.tables.notes.some((row) => row.folder_id === folder.id)) return fail("23503");
            store.tables.note_folders = store.tables.note_folders.filter((row) => row.id !== folder.id);
          }
          return { data: folder.id, error: null };
        }
        assert.equal(name, "move_note_folder");
        store.moves.push({ folderId: args.moving_folder_id!, parentId: args.destination_parent_id! });
        const fail = (code: string) => ({ data: null, error: { code } });
        if (!store.movesReady) return fail("PGRST202");
        if (store.failure) return fail("NETWORK");
        const folder = store.tables.note_folders.find((row) =>
          row.id === args.moving_folder_id && row.owner_id === store.ownerId);
        if (!folder) return fail("42501");
        const ownFolders = store.tables.note_folders.filter((row) => row.owner_id === store.ownerId);
        let parentId = args.destination_parent_id ?? null;
        const visited = new Set<string>();
        while (parentId !== null) {
          if (parentId === folder.id || visited.has(parentId)) return fail("23514");
          visited.add(parentId);
          const parent = ownFolders.find((row) => row.id === parentId);
          if (!parent) return fail("23503");
          parentId = parent.parent_id ?? null;
        }
        if (ownFolders.some((row) => row.id !== folder.id && row.parent_id === args.destination_parent_id &&
          row.name?.toLowerCase() === folder.name?.toLowerCase())) return fail("23505");
        folder.parent_id = args.destination_parent_id;
        return { data: folder.id, error: null };
      },
    }),
  },
});
const { createNoteFolder, loadNoteLibrary, organizeNote, moveNoteFolder, moveSavedNote, renameNoteFolder, deleteEmptyNoteFolder } = await import("@/features/pdf-editor/noteFolders");

beforeEach(() => { store = freshStore(); });

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

test("フォルダの名前だけを変更し、子・ノート・PDF・線を維持する", async () => {
  const parent = await createNoteFolder("情報", null);
  const child = await createNoteFolder("演習", parent);
  const note = addNote();
  await organizeNote(note.id, "ノート1", child);
  const snapshot = structuredClone(store.tables);
  await renameNoteFolder(parent, " 画像処理 ");
  assert.deepEqual(store.managementCalls, [{ name: "rename_note_folder", folderId: parent, newName: "画像処理" }]);
  snapshot.note_folders.find((row) => row.id === parent)!.name = "画像処理";
  assert.deepEqual(store.tables, snapshot);
  assert.equal(folderChoices(buildNoteTree((await loadNoteLibrary()).folders, (await loadNoteLibrary()).notes))[1].path, "画像処理 / 演習");
  await renameNoteFolder(parent, "画像処理");
});

test("名前変更の空白・長さ・同名衝突は拒否し、別階層の同名を許可", async () => {
  const parent = await createNoteFolder("2026", null);
  const folder = await createNoteFolder("Docs", null);
  const other = await createNoteFolder("Other", null);
  const child = await createNoteFolder("Other", parent);
  await assert.rejects(() => renameNoteFolder(folder, "   "), /名前/);
  await assert.rejects(() => renameNoteFolder(folder, "a".repeat(101)), /名前/);
  await assert.rejects(() => renameNoteFolder(folder, "other"), /同じ名前/);
  await renameNoteFolder(child, "docs");
  assert.equal(store.tables.note_folders.find((row) => row.id === folder)?.name, "Docs");
  assert.equal(store.tables.note_folders.find((row) => row.id === other)?.name, "Other");
});

test("空フォルダだけ削除し、親・他のノートを残す", async () => {
  const parent = await createNoteFolder("2026", null);
  const child = await createNoteFolder("空", parent);
  const note = addNote();
  const snapshot = structuredClone(note);
  const library = await loadNoteLibrary();
  assert.equal(canDeleteEmptyFolder(parent, library), false);
  assert.equal(canDeleteEmptyFolder(child, library), true);
  assert.equal(canDeleteEmptyFolder("missing", library), false);
  assert.equal(canDeleteEmptyFolder(child, { ...library, foldersEnabled: false }), false);
  await deleteEmptyNoteFolder(child);
  assert.equal(store.tables.note_folders.length, 1);
  assert.deepEqual(note, snapshot);
  await deleteEmptyNoteFolder(parent);
  assert.equal(store.tables.note_folders.length, 0);
});

test("子フォルダ・ノートがある場合はAPI側でも削除を拒否する", async () => {
  const parent = await createNoteFolder("2026", null);
  const child = await createNoteFolder("情報", parent);
  const note = addNote();
  await organizeNote(note.id, "ノート1", child);
  const snapshot = structuredClone(store.tables);
  const library = await loadNoteLibrary();
  assert.equal(canDeleteEmptyFolder(child, library), false);
  await assert.rejects(() => deleteEmptyNoteFolder(parent), /空のフォルダ/);
  await assert.rejects(() => deleteEmptyNoteFolder(child), /空のフォルダ/);
  assert.deepEqual(store.tables, snapshot);
});

test("他人・不明なフォルダの管理は拒否する", async () => {
  store.tables.note_folders.push({ id: "other", name: "秘密", parent_id: null, owner_id: "owner-b" });
  const snapshot = structuredClone(store.tables);
  for (const id of ["other", "missing"]) {
    await assert.rejects(() => renameNoteFolder(id, "変更"), /変更できません/);
    await assert.rejects(() => deleteEmptyNoteFolder(id), /削除できません/);
  }
  assert.deepEqual(store.tables, snapshot);
});

test("管理SQL未設定・接続失敗・識別情報消失で変更せず、新規ユーザーも作らない", async () => {
  const id = await createNoteFolder("情報", null);
  const snapshot = structuredClone(store.tables);
  store.managementReady = false;
  await assert.rejects(() => renameNoteFolder(id, "変更"), /管理用のSQL/);
  await assert.rejects(() => deleteEmptyNoteFolder(id), /管理用のSQL/);
  store.managementReady = true;
  store.failure = true;
  await assert.rejects(() => renameNoteFolder(id, "変更"), /変更できません/);
  await assert.rejects(() => deleteEmptyNoteFolder(id), /削除できません/);
  store.failure = false;
  store.ownerId = null;
  await assert.rejects(() => renameNoteFolder(id, "変更"), /識別情報/);
  await assert.rejects(() => deleteEmptyNoteFolder(id), /識別情報/);
  assert.equal(store.signIns, 0);
  assert.deepEqual(store.tables, snapshot);
});

function addNote(ownerId = "owner-a"): Row {
  const row = {
    id: `note-${ownerId}`, owner_id: ownerId, file_name: "授業.pdf",
    updated_at: "2026-10-01T00:00:00Z", folder_id: null,
    strokes_by_page: { 1: [{ width: 2.5, points: [{ x: 0.5, y: 0.5 }] }] },
    pdf_path: `${ownerId}/note-${ownerId}.pdf`,
  };
  store.tables.notes.push(row);
  return row;
}
const summary = (id: string, folderId: string | null, title = id): SavedNoteSummary => ({
  id, folderId, title, fileName: `${id}.pdf`, updatedAt: "2026-10-01T00:00:00Z",
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

test("一覧を見るだけでは匿名ユーザーを作らず、最初のフォルダ作成時にだけ作る", async () => {
  store.ownerId = null;
  assert.deepEqual(await loadNoteLibrary(), { notes: [], folders: [], foldersEnabled: true });
  assert.equal(store.signIns, 0);
  await createNoteFolder("2026", null);
  assert.equal(store.signIns, 1);
  assert.equal(store.tables.note_folders[0].owner_id, "new-owner");
});

test("フォルダ用SQLの設定前でも既存ノートを最上位から開ける一覧を返す", async () => {
  store.schemaReady = false;
  addNote();
  const library = await loadNoteLibrary();
  assert.equal(library.foldersEnabled, false);
  assert.equal(library.notes[0].title, "授業");
  assert.equal(library.notes[0].folderId, null);
  assert.equal(store.columns.at(-1), "id, file_name, updated_at");
  await assert.rejects(() => createNoteFolder("2026", null), /SQL/);
});

test("親子フォルダの作成→ノート名と保存先の変更→一覧再取得が成立する", async () => {
  const row = addNote();
  addNote("owner-b");
  const original = structuredClone(row);
  const year = await createNoteFolder(" 2026 ", null);
  const info = await createNoteFolder("情報", year);
  await organizeNote(row.id, " ノート1 ", info);
  const library = await loadNoteLibrary();
  assert.equal(library.notes.length, 1);
  assert.equal(library.notes[0].title, "ノート1");
  assert.equal(library.notes[0].folderId, info);
  const tree = buildNoteTree(library.folders, library.notes);
  assert.equal(tree.folders[0].folders[0].notes[0].id, row.id);
  assert.equal(row.pdf_path, original.pdf_path);
  assert.deepEqual(row.strokes_by_page, original.strokes_by_page);
  await organizeNote(row.id, "ノート1", null);
  assert.equal((await loadNoteLibrary()).notes[0].folderId, null);
});

test("同じ場所の同名フォルダは断り、別の場所なら作成できる", async () => {
  const year = await createNoteFolder("2026", null);
  await assert.rejects(() => createNoteFolder("2026", null), /同じ名前/);
  await createNoteFolder("情報", null);
  await createNoteFolder("情報", year);
  assert.equal(store.tables.note_folders.length, 3);
});

test("空白・長すぎる名前と、他人のフォルダ・ノートへの変更を断る", async () => {
  const note = addNote();
  addNote("owner-b");
  store.tables.note_folders.push({ id: "other-folder", owner_id: "owner-b", name: "秘密", parent_id: null });
  await assert.rejects(() => createNoteFolder("   ", null), /名前/);
  await assert.rejects(() => createNoteFolder("a".repeat(101), null), /名前/);
  await assert.rejects(() => organizeNote(note.id, "", null), /名前/);
  await assert.rejects(() => organizeNote(note.id, "a".repeat(121), null), /名前/);
  await assert.rejects(() => createNoteFolder("子", "other-folder"), /作成できません/);
  await assert.rejects(() => organizeNote(note.id, "ノート1", "other-folder"), /変更できません/);
  await assert.rejects(() => organizeNote("note-owner-b", "ノート1", null), /変更できません/);
  assert.equal(note.folder_id, null);
});

test("フォルダ取得の失敗は、空の一覧として成功扱いしない", async () => {
  store.failure = true;
  await assert.rejects(() => loadNoteLibrary(), /読み込めません/);
});

test("識別情報を失った場合はノート名変更を止め、新しいユーザーを作らない", async () => {
  addNote();
  store.ownerId = null;
  await assert.rejects(() => organizeNote("note-owner-a", "ノート1", null), /識別情報/);
  assert.equal(store.signIns, 0);
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

test("ノート移動は名前・線・元PDFを変更せず、最上位にも戻せる", async () => {
  const note = addNote();
  note.title = "ノート1";
  const original = structuredClone(note);
  const folderId = await createNoteFolder("情報", null);
  await moveSavedNote(note.id, folderId);
  assert.equal((await loadNoteLibrary()).notes[0].folderId, folderId);
  assert.equal(note.title, original.title);
  assert.deepEqual(note.strokes_by_page, original.strokes_by_page);
  assert.equal(note.pdf_path, original.pdf_path);
  await moveSavedNote(note.id, null);
  assert.equal(note.folder_id, null);
});

test("フォルダ移動では子フォルダとノートをそのまま保持し、再取得で新しい階層になる", async () => {
  const year = await createNoteFolder("2026", null);
  const nextYear = await createNoteFolder("2027", null);
  const info = await createNoteFolder("情報", year);
  const child = await createNoteFolder("演習", info);
  const note = addNote();
  await organizeNote(note.id, "ノート1", child);
  const original = structuredClone(note);
  await moveNoteFolder(info, nextYear);
  assert.deepEqual(store.moves, [{ folderId: info, parentId: nextYear }]);
  const tree = buildNoteTree((await loadNoteLibrary()).folders, (await loadNoteLibrary()).notes);
  assert.equal(tree.folders[1].folders[0].folders[0].notes[0].id, note.id);
  assert.deepEqual(note, original);
  assert.equal(store.tables.note_folders.find((row) => row.id === child)?.parent_id, info);
  await moveNoteFolder(info, null);
  assert.equal(store.tables.note_folders.find((row) => row.id === info)?.parent_id, null);
});

test("フォルダ移動の自己・子孫・同名衝突はエラーにして階層を変えない", async () => {
  const year = await createNoteFolder("2026", null);
  const info = await createNoteFolder("情報", year);
  const other = await createNoteFolder("情報", null);
  const snapshot = structuredClone(store.tables.note_folders);
  await assert.rejects(() => moveNoteFolder(year, year), /自分自身/);
  await assert.rejects(() => moveNoteFolder(year, info), /子フォルダ/);
  await assert.rejects(() => moveNoteFolder(other, year), /同じ名前/);
  assert.deepEqual(store.tables.note_folders, snapshot);
});

test("他人のノート・フォルダや不明な移動先を断る", async () => {
  const note = addNote();
  const otherNote = addNote("owner-b");
  const ownFolder = await createNoteFolder("情報", null);
  store.tables.note_folders.push({ id: "other", name: "情報", parent_id: null, owner_id: "owner-b" });
  const snapshot = structuredClone(store.tables);
  await assert.rejects(() => moveSavedNote(otherNote.id, ownFolder), /移動できません/);
  await assert.rejects(() => moveSavedNote(note.id, "other"), /移動できません/);
  await assert.rejects(() => moveNoteFolder("other", ownFolder), /移動できません/);
  await assert.rejects(() => moveNoteFolder(ownFolder, "other"), /移動できません/);
  await assert.rejects(() => moveNoteFolder(ownFolder, "missing"), /移動できません/);
  assert.deepEqual(store.tables, snapshot);
});

test("未設定の移動用SQL・接続失敗・識別情報の消失では更新せず案内する", async () => {
  const folderId = await createNoteFolder("情報", null);
  const note = addNote();
  store.movesReady = false;
  await assert.rejects(() => moveNoteFolder(folderId, null), /移動用のSQL/);
  store.movesReady = true;
  store.failure = true;
  await assert.rejects(() => moveNoteFolder(folderId, null), /移動できません/);
  await assert.rejects(() => moveSavedNote(note.id, folderId), /移動できません/);
  store.failure = false;
  store.ownerId = null;
  await assert.rejects(() => moveNoteFolder(folderId, null), /識別情報/);
  await assert.rejects(() => moveSavedNote(note.id, folderId), /識別情報/);
  assert.equal(store.signIns, 0);
  assert.equal(note.folder_id, null);
});
