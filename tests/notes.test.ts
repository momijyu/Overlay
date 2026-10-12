import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { PDFDocument } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";

import type { PenStroke } from "@/features/pdf-editor/types";

type NoteRow = {
  id: string;
  owner_id: string;
  file_name: string;
  pdf_path: string;
  strokes_by_page: unknown;
  updated_at: string;
  title?: string;
  folder_id?: string | null;
};
type Call = { operation: string; args: unknown[] };
type DatabaseError = { message: string; status: number };

// 実際のSupabaseへ接続せず、API呼び出しと保存結果をメモリ上で確認する。
function createStore() {
  return {
    userId: "owner-a" as string | null,
    rows: [] as NoteRow[],
    pdfs: new Map<string, Blob>(),
    calls: [] as Call[],
    sessionError: null as string | null,
    signInError: null as string | null,
    databaseError: null as DatabaseError | null,
    uploadError: null as string | null,
    downloadError: null as string | null,
  };
}
let store = createStore();

function record(operation: string, ...args: unknown[]) {
  store.calls.push({ operation, args });
}

class NoteQuery {
  private filters = new Map<string, string>();
  private newestFirst = false;
  private insertValue: Omit<NoteRow, "updated_at"> | null = null;
  private updateValue: Partial<NoteRow> | null = null;

  select(columns: string) {
    record("select", columns);
    return this;
  }
  eq(column: string, value: string) {
    record("eq", column, value);
    this.filters.set(column, value);
    return this;
  }
  order(column: string, options: { ascending: boolean }) {
    record("order", column, options);
    this.newestFirst = column === "updated_at" && !options.ascending;
    return this;
  }
  overrideTypes() { return this; }
  insert(value: Omit<NoteRow, "updated_at">) {
    record("insert", value);
    this.insertValue = value;
    return this;
  }
  update(value: Partial<NoteRow>) {
    record("update", value);
    this.updateValue = value;
    return this;
  }

  private execute(single: boolean) {
    if (store.databaseError) {
      return { data: null, error: store.databaseError, status: store.databaseError.status };
    }
    if (this.insertValue) {
      store.rows.push({ ...this.insertValue, updated_at: new Date().toISOString() });
    }
    const rows = store.rows.filter((row) =>
      [...this.filters].every(([key, value]) => row[key as keyof NoteRow] === value),
    );
    if (this.updateValue) rows.forEach((row) => Object.assign(row, this.updateValue));
    if (this.newestFirst) rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (single && rows.length !== 1) {
      return { data: null, error: { message: "No matching note" }, status: 406 };
    }
    return { data: single ? rows[0] : rows, error: null, status: 200 };
  }
  single() {
    return Promise.resolve(this.execute(true));
  }
  then(resolve: (value: ReturnType<NoteQuery["execute"]>) => unknown) {
    return Promise.resolve(this.execute(false)).then(resolve);
  }
}

const fakeClient = {
  auth: {
    async getSession() {
      return {
        data: { session: store.userId ? { user: { id: store.userId } } : null },
        error: store.sessionError,
      };
    },
    async signInAnonymously() {
      record("signInAnonymously");
      if (store.signInError) return { data: { user: null }, error: store.signInError };
      store.userId = "new-owner";
      return { data: { user: { id: store.userId } }, error: null };
    },
  },
  from(table: string) {
    assert.equal(table, "notes");
    record("from", table);
    return new NoteQuery();
  },
  storage: {
    from(bucket: string) {
      assert.equal(bucket, "overlay-pdfs");
      return {
        async upload(path: string, file: File, options: unknown) {
          record("upload", path, options);
          if (store.uploadError) return { error: store.uploadError };
          assert(!store.pdfs.has(path), "元PDFを上書きしない");
          store.pdfs.set(path, file);
          return { error: null };
        },
        async download(path: string) {
          record("download", path);
          return {
            data: store.pdfs.get(path) ?? null,
            error: store.downloadError,
          };
        },
        async remove(paths: string[]) {
          record("remove", paths);
          paths.forEach((path) => store.pdfs.delete(path));
          return { error: null };
        },
      };
    },
  },
};

mock.module("@/lib/supabase/client", {
  exports: { getSupabaseClient: () => fakeClient },
});
const { listSavedNotes, loadSavedNote } = await import("@/features/pdf-editor/loadNotes");
const { saveNote } = await import("@/features/pdf-editor/saveNote");
const { exportAnnotatedPdf } = await import("@/features/pdf-editor/exportAnnotatedPdf");

const strokes: Record<number, PenStroke[]> = {
  1: [{ width: 1.5, points: [{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.8 }] }],
  2: [{ width: 5, points: [{ x: 1, y: 0 }] }],
};
const file = new File(["original PDF"], "授業.pdf", { type: "application/pdf" });

function addNote(id = "note-a", ownerId = "owner-a", updatedAt = "2026-10-12T00:00:00Z") {
  const row: NoteRow = {
    id, owner_id: ownerId, file_name: file.name,
    pdf_path: `${ownerId}/${id}.pdf`, strokes_by_page: structuredClone(strokes),
    updated_at: updatedAt,
  };
  store.rows.push(row);
  store.pdfs.set(row.pdf_path, file);
  return row;
}

beforeEach(() => { store = createStore(); });

test("識別情報がない一覧は空で、新しい匿名ユーザーを作らない", async () => {
  store.userId = null;
  assert.deepEqual(await listSavedNotes(), []);
  await assert.rejects(() => loadSavedNote("note-a"), /識別情報/);
  assert.deepEqual(store.calls, []);
});

test("所有者のノートだけを更新日時順に取得し、一覧ではPDFを取得しない", async () => {
  addNote("old", "owner-a", "2026-10-01T00:00:00Z");
  addNote("other", "owner-b");
  addNote("new", "owner-a");
  const notes = await listSavedNotes();
  assert.deepEqual(notes.map((note) => note.id), ["new", "old"]);
  assert.equal(notes[0].fileName, "授業.pdf");
  assert(store.calls.some((call) => call.operation === "eq" && call.args[0] === "owner_id" && call.args[1] === "owner-a"));
  assert(!store.calls.some((call) => call.operation === "download"));
});

test("初回保存→一覧→復元→追記→同じIDへ更新→復元が成立する", async () => {
  store.userId = null;
  const id = await saveNote({ file, strokesByPage: strokes, noteId: null });
  assert.equal(store.rows.length, 1);
  assert.equal(store.pdfs.size, 1);
  assert.equal((await listSavedNotes())[0].id, id);
  const loaded = await loadSavedNote(id);
  assert.equal(loaded.file.name, file.name);
  assert.equal(loaded.file.type, "application/pdf");
  assert.equal(await loaded.file.text(), await file.text());
  assert.deepEqual(loaded.strokesByPage, strokes);

  const edited = structuredClone(loaded.strokesByPage);
  edited[1].push({ width: 2.5, points: [{ x: 0.4, y: 0.5 }] });
  assert.equal(await saveNote({ file: loaded.file, strokesByPage: edited, noteId: id }), id);
  assert.equal(store.rows.length, 1);
  assert.equal(store.pdfs.size, 1);
  assert.equal(store.calls.filter((call) => call.operation === "upload").length, 1);
  assert.deepEqual((await loadSavedNote(id)).strokesByPage, edited);
});

test("別ノートのページごとの線が混ざらない", async () => {
  addNote("first");
  const second = addNote("second");
  second.strokes_by_page = { 2: [] };
  assert.deepEqual((await loadSavedNote("first")).strokesByPage, strokes);
  assert.deepEqual((await loadSavedNote("second")).strokesByPage, { 2: [] });
});

test("線の再保存でノート名・所属フォルダを上書きしない", async () => {
  const row = addNote();
  row.title = "ノート1";
  row.folder_id = "folder-info";
  await saveNote({ file, strokesByPage: { 1: [] }, noteId: row.id });
  assert.equal(row.title, "ノート1");
  assert.equal(row.folder_id, "folder-info");
  assert.equal((await listSavedNotes(true))[0].title, "ノート1");
  assert.equal((await listSavedNotes(true))[0].folderId, "folder-info");
  assert.deepEqual((await loadSavedNote(row.id)).strokesByPage, { 1: [] });
});

test("他の所有者のノートは読み込み・更新できず、PDFも取得しない", async () => {
  const row = addNote("other", "owner-b");
  await assert.rejects(() => loadSavedNote(row.id), /ノートを読み込めません/);
  await assert.rejects(() => saveNote({ file, strokesByPage: {}, noteId: row.id }), /保存できません/);
  assert.deepEqual(row.strokes_by_page, strokes);
  assert(!store.calls.some((call) => ["upload", "download", "insert"].includes(call.operation)));
});

test("既存ノートの識別情報が失われた場合、新しい匿名ユーザーを作らず再保存を止める", async () => {
  addNote();
  store.userId = null;
  await assert.rejects(() => saveNote({ file, strokesByPage: strokes, noteId: "note-a" }), /識別情報/);
  assert.deepEqual(store.calls, []);
});

test("不正な線データは描画用に返さず、元PDFも取得しない", async () => {
  const row = addNote();
  const invalidData = [
    null, [], { 0: [] }, { "01": [] },
    { 1: [{ width: 0, points: [{ x: 0, y: 0 }] }] },
    { 1: [{ width: 2, points: [] }] },
    { 1: [{ width: 2, points: [{ x: 1.2, y: 0 }] }] },
    { 1: [{ width: 2, points: [{ x: Number.NaN, y: 0 }] }] },
  ];
  for (const data of invalidData) {
    row.strokes_by_page = data;
    await assert.rejects(() => loadSavedNote(row.id), /書き込み情報/);
  }
  assert(!store.calls.some((call) => call.operation === "download"));
});

test("元PDFの保存場所が所有者・ノートIDと一致しない場合は取得しない", async () => {
  const row = addNote();
  row.pdf_path = "owner-b/note-a.pdf";
  await assert.rejects(() => loadSavedNote(row.id), /PDFの情報/);
  assert(!store.calls.some((call) => call.operation === "download"));
});

test("接続・一覧・ダウンロードの失敗をエラーとして返す", async () => {
  addNote();
  store.sessionError = "session failure";
  await assert.rejects(() => listSavedNotes(), /接続/);
  store.sessionError = null;
  store.databaseError = { message: "database failure", status: 503 };
  await assert.rejects(() => listSavedNotes(), /ノート一覧/);
  store.databaseError = null;
  store.downloadError = "download failure";
  await assert.rejects(() => loadSavedNote("note-a"), /PDFを読み込めません/);
});

test("更新失敗時は保存済みの線と元PDFを変更しない", async () => {
  const row = addNote();
  store.databaseError = { message: "update failure", status: 503 };
  await assert.rejects(() => saveNote({ file, strokesByPage: {}, noteId: row.id }), /保存できません/);
  assert.deepEqual(row.strokes_by_page, strokes);
  assert.equal(store.pdfs.size, 1);
  assert(!store.calls.some((call) => ["upload", "remove", "insert"].includes(call.operation)));
});

for (const status of [403, 408, 503]) {
  test(`初回保存の失敗（${status}）では、拒否が確定した場合だけ元PDFを後片付けする`, async () => {
    store.databaseError = { message: "insert failure", status };
    await assert.rejects(() => saveNote({ file, strokesByPage: strokes, noteId: null }), /保存できません/);
    assert.equal(store.rows.length, 0);
    assert.equal(store.pdfs.size, status === 403 ? 0 : 1);
  });
}

test("復元した複数ページの線をPDFに出力しても、保存した元PDFは変わらない", async () => {
  const original = await PDFDocument.create();
  original.addPage([200, 300]);
  original.addPage([200, 300]);
  const bytes = await original.save();
  const originalFile = new File([new Uint8Array(bytes)], "two-pages.pdf", { type: "application/pdf" });
  const id = await saveNote({ file: originalFile, strokesByPage: strokes, noteId: null });
  const loaded = await loadSavedNote(id);
  // PDF.jsの表示座標→PDF座標変換を、回転のない200×300ページとして再現する。
  const displayed = {
    numPages: 2,
    getPage: async () => ({ getViewport: () => ({
      width: 200, height: 300,
      convertToPdfPoint: (x: number, y: number) => [x, 300 - y],
    }) }),
  } as unknown as PDFDocumentProxy;
  const output = await exportAnnotatedPdf(loaded.file, displayed, loaded.strokesByPage);
  const exported = await PDFDocument.load(output);
  assert.equal(exported.getPageCount(), 2);
  assert(exported.getPages().every((page) => page.node.Contents()));
  assert.deepEqual(new Uint8Array(await loaded.file.arrayBuffer()), bytes);
  assert.deepEqual(new Uint8Array(await store.pdfs.get(store.rows[0].pdf_path)!.arrayBuffer()), bytes);
});
