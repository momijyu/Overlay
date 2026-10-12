import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

import { buildNoteTree, folderChoices } from "@/features/pdf-editor/noteTree";
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
    failure: false,
    signIns: 0,
    columns: [] as string[],
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
    }),
  },
});
const { createNoteFolder, loadNoteLibrary, organizeNote } = await import("@/features/pdf-editor/noteFolders");

beforeEach(() => { store = freshStore(); });

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
