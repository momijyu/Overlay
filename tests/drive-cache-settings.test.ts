import assert from "node:assert/strict";
import test, { beforeEach, mock, afterEach } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { readDriveCacheLimit, saveDriveCacheLimit } from "@/features/pdf-editor/driveCacheSettings";
import { readDriveCacheSummary } from "@/features/pdf-editor/driveLibraryCache";
import { subscribeDriveQueue } from "@/features/pdf-editor/driveQueueEvents";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
beforeEach(() => { Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() }); });
afterEach(() => mock.restoreAll());
const readLimit = () => withLocalTransaction(["driveSettings"], "readonly", readDriveCacheLimit);

test("キャッシュ初期値250MBと100〜1000MBの整数設定を、このブラウザだけに永続化する", async () => {
  assert.equal(await readLimit(), 250);
  const originalDB = indexedDB;
  for (const limit of [100, 325, 1000]) { await saveDriveCacheLimit(limit); assert.equal(await readLimit(), limit); }
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  assert.equal(await readLimit(), 250);
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalDB });
  assert.equal(await readLimit(), 1000);
});

test("範囲外・小数・非数は保存せず、破損した旧設定には初期値を使用する", async () => {
  await saveDriveCacheLimit(300);
  for (const invalid of [0, 99, 1001, 250.5, NaN, Infinity]) {
    await assert.rejects(saveDriveCacheLimit(invalid), /100〜1000MBの整数/); assert.equal(await readLimit(), 300);
  }
  await withLocalTransaction(["driveSettings"], "readwrite", async (tx) => {
    await readRequest(tx.objectStore("driveSettings").put({ id: "cache-limit-mb", value: "bad" }));
  }, false);
  assert.equal(await readLimit(), 250);
});

test("容量設定では本文・送信待ち・Driveの階層を変更せず、完了後に状態更新を通知する", async () => {
  let notified = 0; const unsubscribe = subscribeDriveQueue(() => { notified++; });
  try {
    await saveDriveCacheLimit(100); assert.equal(notified, 1);
    await withLocalTransaction(["notes", "pdfs", "driveTreeEvents", "driveBindings"], "readonly", async (tx) => {
      for (const name of ["notes", "pdfs", "driveTreeEvents", "driveBindings"]) assert.equal(await readRequest(tx.objectStore(name).count()), 0);
    });
    assert.deepEqual(await readDriveCacheSummary(), { limitMB: 100, bytes: 0 });
  } finally { unsubscribe(); }
});

test("設定の書込失敗時は元の上限を維持する", async () => {
  await saveDriveCacheLimit(400);
  const { IDBObjectStore } = await import("fake-indexeddb");
  mock.method(IDBObjectStore.prototype, "put", () => { throw new Error("書込失敗"); });
  await assert.rejects(saveDriveCacheLimit(100), /書込失敗/); assert.equal(await readLimit(), 400);
});
