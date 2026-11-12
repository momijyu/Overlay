import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import * as React from "react";
import { IDBFactory } from "fake-indexeddb";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
import * as libraryLocal from "@/features/pdf-editor/driveLibraryLocal";
import * as noteDriveStatus from "@/features/pdf-editor/noteDriveStatus";
import type { LibraryScope } from "@/features/pdf-editor/driveLibraryData";
import { notifyLibraryChanged } from "@/features/pdf-editor/driveLibraryEvents";

type Effect = { dependencies?: React.DependencyList; cleanup?: () => void };
let states: unknown[], refs: { current: unknown }[], effects: Effect[];
let stateIndex = 0, refIndex = 0, effectIndex = 0;
let pendingEffects: (() => void)[], dirty = false;
mock.module("react", { exports: { ...React,
  useCallback: <T,>(callback: T) => callback,
  useState(initial: unknown) {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], (next: unknown) => {
      const value = typeof next === "function" ? next(states[index]) : next;
      if (!Object.is(value, states[index])) { states[index] = value; dirty = true; }
    }];
  },
  useRef(initial: unknown) { return refs[refIndex++] ??= { current: initial }; },
  useEffect(callback: () => void | (() => void), dependencies?: React.DependencyList) {
    const index = effectIndex++, previous = effects[index];
    if (previous && dependencies && previous.dependencies
      && dependencies.length === previous.dependencies.length
      && dependencies.every((value, i) => Object.is(value, previous.dependencies![i]))) return;
    pendingEffects.push(() => {
      previous?.cleanup?.();
      effects[index] = { dependencies, cleanup: callback() || undefined };
    });
  },
} });

const scope: LibraryScope = { accountId: "account", rootId: "root", deviceId: "device" };
type Connection = { account: { id: string }; root: { id: string } | null } | null;
let connection: Connection, listeners: Set<() => void>;
let readScope: () => Promise<LibraryScope | null>;
mock.module("@/features/pdf-editor/googleDriveSession", { exports: {
  getGoogleDriveSession: () => ({ getConnection: () => connection, subscribe: (listener: () => void) => {
    listeners.add(listener); return () => { listeners.delete(listener); };
  } }),
} });
mock.module("@/features/pdf-editor/driveLibraryLocal", { exports: {
  ...libraryLocal, getLibraryScope: () => readScope(),
} });
mock.module("@/features/pdf-editor/noteDriveStatus", { exports: {
  ...noteDriveStatus, readNoteDriveStatuses: async () => ({}),
} });
const { NotebookSidebar } = await import("@/features/pdf-editor/components/NotebookSidebar");
const { NotebookTree } = await import("@/features/pdf-editor/components/NotebookTree");
const { StickyNotesPanel } = await import("@/features/pdf-editor/components/StickyNotesPanel");
let node: React.ReactNode;

beforeEach(async () => {
  states = []; refs = []; effects = []; pendingEffects = []; listeners = new Set();
  connection = null; readScope = async () => scope;
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  mock.timers.enable({ apis: ["setInterval"] });
  await withLocalTransaction(["notes", "pdfs", "noteSummaries"], "readwrite", async (tx) => {
    for (const id of ["local", "cloud"]) {
      const summary = { id, title: id, folderId: null, fileName: `${id}.pdf`, updatedAt: "2026-11-09",
        stickyNotes: [{ pageId: 1, pageNumber: 1, textId: id, label: id }] };
      await readRequest(tx.objectStore("noteSummaries").put(summary));
      if (id === "local") {
        await readRequest(tx.objectStore("notes").put({ ...summary, strokesByPage: {} }));
        await readRequest(tx.objectStore("pdfs").put({ id, blob: new Blob(["%PDF-1.7"]) }));
      }
    }
  }, false);
});
afterEach(() => { effects.forEach((effect) => effect.cleanup?.()); mock.timers.reset(); });

function render() {
  dirty = false; stateIndex = 0; refIndex = 0; effectIndex = 0; pendingEffects = [];
  node = NotebookSidebar({ refreshVersion: 0, currentNoteId: null, disabled: false,
    onOpen() {}, onRenamed() {}, onDelete: async () => {}, onDeleteItems: async () => {},
    onMutationChange() {}, onOpenSticky() {}, visible: false });
  for (const effect of pendingEffects) effect();
}
async function settle() {
  for (let i = 0; i < 30; i++) { await new Promise(setImmediate); if (dirty) render(); }
}
function entries(value: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(value).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...entries(child.props.children as React.ReactNode)] : []);
}
function notes() {
  return entries(node).find((entry) => entry.type === StickyNotesPanel)!.props.notes as { id: string }[];
}
function connect(value: Connection) { connection = value; for (const listener of listeners) listener(); render(); }

test("未接続・期限切れはローカルだけ、同じDriveへの接続・再接続でクラウドと付箋を戻す", async () => {
  render(); await settle();
  assert.deepEqual(notes().map((note) => note.id), ["local"]);
  connect({ account: { id: "account" }, root: { id: "root" } }); await settle();
  assert.deepEqual(notes().map((note) => note.id).sort(), ["cloud", "local"]);
  connect(null);
  assert.deepEqual(notes(), []); // 読み込み中も前のクラウド付箋を残さない。
  assert.equal(entries(node).find((entry) => entry.type === NotebookTree), undefined);
  await settle(); assert.deepEqual(notes().map((note) => note.id), ["local"]);
  connect({ account: { id: "account" }, root: { id: "root" } }); await settle();
  assert.deepEqual(notes().map((note) => note.id).sort(), ["cloud", "local"]);
});

test("アカウント・保存先が違う接続と未設定の保存先ではクラウド一覧を表示しない", async () => {
  render(); await settle();
  for (const value of [
    { account: { id: "other" }, root: { id: "root" } },
    { account: { id: "account" }, root: { id: "other" } },
    { account: { id: "account" }, root: null },
  ]) {
    connect(value); await settle(); assert.deepEqual(notes().map((note) => note.id), ["local"]);
  }
});

test("切断前に始めた遅い取得は、切断後のローカル一覧を上書きしない", async () => {
  render(); await settle();
  let release!: (value: LibraryScope) => void;
  const waiting = new Promise<LibraryScope>((resolve) => { release = resolve; });
  readScope = () => waiting;
  connect({ account: { id: "account" }, root: { id: "root" } });
  readScope = async () => scope;
  connect(null); await settle();
  assert.deepEqual(notes().map((note) => note.id), ["local"]);
  release(scope); await settle();
  assert.deepEqual(notes().map((note) => note.id), ["local"]);
});

test("切断時にDriveの空階層を隠し、本文整理の通知で不要になった祖先も一覧から除く", async () => {
  await withLocalTransaction(["folders", "noteSummaries", "driveEntities", "driveSettings", "driveTreeEvents"], "readwrite", async (tx) => {
    const changes = ["parent", "remote-empty"].map((id) => ({ before: null,
      entry: { id, kind: "folder" as const, name: id, parentId: null } }));
    await readRequest(tx.objectStore("driveSettings").put({ id: "library", value: scope }));
    await readRequest(tx.objectStore("driveTreeEvents").put({ id: "creation", sent: true,
      event: { id: "creation", schemaVersion: 1, kind: "overlay-library-event", deviceId: "other", changes } }));
    for (const { entry } of changes) {
      await readRequest(tx.objectStore("folders").put({ ...entry }));
      await readRequest(tx.objectStore("driveEntities").put({ id: `folder:${entry.id}`, entry, head: "creation", sources: [] }));
    }
    await readRequest(tx.objectStore("folders").put({ id: "local-empty", name: "local-empty", parentId: null }));
    const store = tx.objectStore("noteSummaries"), local = await readRequest(store.get("local"));
    await readRequest(store.put({ ...local, folderId: "parent" }));
  }, false);
  const folderIds = () => (entries(node).find((entry) => entry.type === NotebookTree)!.props.tree as { folders: { id: string }[] })
    .folders.map((folder) => folder.id).sort();
  render(); await settle();
  assert.deepEqual(folderIds(), ["local-empty", "parent"]);
  connect({ account: { id: "account" }, root: { id: "root" } }); await settle();
  assert.deepEqual(folderIds(), ["local-empty", "parent", "remote-empty"]);
  connect(null); await settle();
  assert.deepEqual(folderIds(), ["local-empty", "parent"]);
  await withLocalTransaction(["notes", "pdfs"], "readwrite", async (tx) => {
    await readRequest(tx.objectStore("notes").delete("local"));
    await readRequest(tx.objectStore("pdfs").delete("local"));
  }, false);
  notifyLibraryChanged(); await settle();
  assert.deepEqual(notes(), []);
  assert.deepEqual(folderIds(), ["local-empty"]);
});
