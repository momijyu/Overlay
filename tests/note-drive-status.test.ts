import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readNoteDriveStatuses, noteDriveStatuses, NOTE_DRIVE_LABELS } from "@/features/pdf-editor/noteDriveStatus";
import { NotebookDriveBadge } from "@/features/pdf-editor/components/NotebookDriveBadge";
import { NotebookTree, type NotebookTreeProps } from "@/features/pdf-editor/components/NotebookTree";
import type { DriveBinding } from "@/features/pdf-editor/driveOutbox";
import type { LibraryEntity } from "@/features/pdf-editor/driveLibraryData";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";

const source = { logicalId: "note", noteId: "json", noteKey: "key", containerId: "container", deviceId: "device", fileName: "file.pdf" };
const entity = (id = "note"): LibraryEntity => ({ id: `note:${id}`, entry: { kind: "note", id, name: id, parentId: null }, head: "head", sources: [{ ...source, logicalId: id }] });
const binding = (changes: Partial<DriveBinding> = {}): DriveBinding => ({ id: "note", key: "key", deviceId: "device", accountId: "account", rootId: "root", enabled: true,
  generation: 2, uploadedGeneration: 2, dirtySince: 0, changedAt: 0, ids: { note: "json", container: "container", pdf: "pdf" }, uploadedHash: "hash", ...changes });
beforeEach(() => { Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() }); });
afterEach(() => mock.restoreAll());

test("Drive保存済み・初回送信待ち・編集中・失敗を区別し、ブラウザ専用へ雲を付けない", () => {
  assert.deepEqual(noteDriveStatuses([], [], false), {});
  assert.deepEqual(noteDriveStatuses([], [{ ...entity(), sources: [] }], false), {});
  assert.equal(noteDriveStatuses([], [entity()], false).note, "saved"); // 他端末からの一覧のみでもDriveに存在する。
  assert.equal(noteDriveStatuses([binding()], [], false).note, "saved");
  assert.equal(noteDriveStatuses([binding({ generation: 1, uploadedGeneration: 0, ids: undefined, uploadedHash: undefined })], [], false).note, "pending");
  assert.equal(noteDriveStatuses([binding({ generation: 3 })], [entity()], false).note, "pending");
  assert.equal(noteDriveStatuses([binding({ generation: 3, error: "通信失敗" })], [entity()], false).note, "warning");
  assert.equal(noteDriveStatuses([binding({ generation: 3, retryAt: 10000 })], [entity()], false).note, "pending");
});

test("別端末の複数版・背景の更新差分は要確認、階層送信中は保存済みと表示しない", () => {
  assert.equal(noteDriveStatuses([binding({ generation: 3 })], [{ ...entity(), cacheWarning: "Driveで更新" }], false).note, "warning");
  assert.equal(noteDriveStatuses([], [{ ...entity(), sources: [source, { ...source, noteId: "other" }] }], false).note, "warning");
  assert.equal(noteDriveStatuses([binding()], [entity()], true).note, "pending");
  assert.deepEqual(noteDriveStatuses([binding()], [{ ...entity(), entry: { ...entity().entry, deleted: true } }], false), {});
});

test("一覧マークの取得はPDF・本文・階層履歴を走査せず小さい保存状態だけ読む", async () => {
  await withLocalTransaction(["driveEntities", "driveBindings"], "readwrite", async (tx) => {
    await readRequest(tx.objectStore("driveEntities").put(entity()));
    await readRequest(tx.objectStore("driveBindings").put(binding({ generation: 3 })));
  }, false);
  const reads: string[] = []; const original = IDBObjectStore.prototype.getAll;
  mock.method(IDBObjectStore.prototype, "getAll", function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
    reads.push(this.name); return original.apply(this, args);
  });
  assert.deepEqual(await readNoteDriveStatuses(), { note: "pending" });
  assert.deepEqual(reads.sort(), ["driveBindings", "driveEntities"]);
});

test("Driveにもローカルにもあるノートは、保存済み・未送信・要確認でも雲を表示しない", () => {
  const local = new Set(["note"]);
  for (const current of [binding(), binding({ generation: 3 }), binding({ error: "競合" })]) {
    assert.deepEqual(noteDriveStatuses([current], [entity()], false, local), {});
  }
  assert.deepEqual(noteDriveStatuses([], [{ ...entity(), sources: [source, { ...source, noteId: "other" }] }], true, local), {});
});

test("PDFと本文がローカルにそろうと雲が消え、キャッシュ整理後は雲を表示する", async () => {
  await withLocalTransaction(["driveEntities"], "readwrite", async (tx) => {
    await readRequest(tx.objectStore("driveEntities").put(entity()));
  }, false);
  assert.deepEqual(await readNoteDriveStatuses(), { note: "saved" });
  await withLocalTransaction(["notes"], "readwrite", async (tx) => {
    await readRequest(tx.objectStore("notes").put({ id: "note", title: "資料" }));
  }, false);
  assert.deepEqual(await readNoteDriveStatuses(), { note: "saved" });
  await withLocalTransaction(["pdfs"], "readwrite", async (tx) => {
    await readRequest(tx.objectStore("pdfs").put({ id: "note", blob: new Blob(["%PDF-"]) }));
  }, false);
  assert.deepEqual(await readNoteDriveStatuses(), {});
  await withLocalTransaction(["notes", "pdfs"], "readwrite", async (tx) => {
    await readRequest(tx.objectStore("notes").delete("note"));
    await readRequest(tx.objectStore("pdfs").delete("note"));
  }, false);
  assert.deepEqual(await readNoteDriveStatuses(), { note: "saved" });
});

test("保存状態は3種類のSVGと読み上げ・ホバー・指で確認でき、雲を押してもノートを開かない", () => {
  const drawings: string[] = [];
  for (const status of ["saved", "pending", "warning"] as const) {
    const element = NotebookDriveBadge({ status });
    const html = renderToStaticMarkup(element); drawings.push(html);
    assert.ok(html.includes(`aria-label="${NOTE_DRIVE_LABELS[status]}"`));
    assert.match(html, /tabindex="0"/); assert.match(html, /data-tip=/); assert.match(html, /<svg/);
    assert.doesNotMatch(html, /<button|<img|\p{Extended_Pictographic}/u);
    let stopped = false, prevented = false;
    element.props.onClick({ stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
    assert.ok(stopped && prevented);
  }
  assert.equal(new Set(drawings).size, 3);
});

test("階層内のノートにも雲を表示し、長い名前を省略してもマークの表示枠を確保する", () => {
  const note = { id: "note", title: "長いノート名", fileName: "file.pdf", folderId: "folder", updatedAt: "2026-11-05" };
  const props: NotebookTreeProps = { tree: { notes: [], folders: [{ id: "folder", name: "授業", parentId: null, notes: [note], folders: [] }] },
    currentNoteId: null, selected: null, disabled: false, expanded: new Set(["folder"]), dragEnabled: true, dragging: null, dropTarget: null,
    driveStatuses: { note: "saved" }, onSelect() {}, onOpen() {}, onToggle() {}, onDragStart() {}, onDragEnd() {}, onDragOver() {}, onDragLeave() {}, onDrop() {} };
  const html = renderToStaticMarkup(createElement(NotebookTree, props));
  assert.match(html, /長いノート名/); assert.match(html, /notebook-drive-status/); assert.match(html, /Driveから取得が必要/);
});
