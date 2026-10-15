import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import { IDBFactory, IDBVersionChangeEvent } from "fake-indexeddb";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";

beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
});
afterEach(() => mock.restoreAll());

async function getConnection() {
  return withLocalTransaction(["notes"], "readonly", async (transaction) => transaction.db);
}

test("同時Openと後続のトランザクションで1つの接続を共有し、毎回closeしない", async () => {
  const opening = mock.method(indexedDB, "open");
  const [a, b] = await Promise.all([getConnection(), getConnection()]);
  const closing = mock.method(a, "close");
  assert.equal(a, b);
  assert.equal(await getConnection(), a);
  assert.equal(opening.mock.callCount(), 1);
  assert.equal(closing.mock.callCount(), 0);
});

test("versionchangeで接続を閉じてキャッシュを破棄し、次回は開き直す", async () => {
  const database = await getConnection();
  const closing = mock.method(database, "close");
  database.dispatchEvent(new IDBVersionChangeEvent("versionchange", { oldVersion: 1, newVersion: 2 }));
  assert.equal(closing.mock.callCount(), 1);
  assert.notEqual(await getConnection(), database);
});

test("予期しないcloseイベントを受けた接続を再利用しない", async () => {
  const database = await getConnection();
  // 強制切断通知を模擬する。close()自体はcloseイベントを発火しない。
  database.close();
  database.dispatchEvent(new IDBVersionChangeEvent("close"));
  assert.notEqual(await getConnection(), database);
});

test("通知なしで閉じられた接続は処理開始前にだけ再接続する", async () => {
  const database = await getConnection();
  database.close();
  let workCalls = 0;
  await withLocalTransaction(["notes"], "readwrite", async (transaction) => {
    workCalls++;
    await readRequest(transaction.objectStore("notes").add({ id: "once" }));
  });
  assert.equal(workCalls, 1);
  assert.notEqual(await getConnection(), database);
});

test("Open失敗をキャッシュせず、次の操作で再接続できる", async () => {
  const failing = mock.method(indexedDB, "open", () => { throw new DOMException("failure", "UnknownError"); });
  await assert.rejects(getConnection(), /保存場所へアクセスできません/);
  failing.mock.restore();
  assert.ok(await getConnection());
});

test("致命的なUnknownErrorでは接続を破棄するが、書き込み処理を勝手に再試行しない", async () => {
  const database = await getConnection();
  let workCalls = 0;
  await assert.rejects(withLocalTransaction(["notes"], "readwrite", async (transaction) => {
    workCalls++;
    await readRequest(transaction.objectStore("notes").add({ id: "rollback" }));
    throw new DOMException("failure", "UnknownError");
  }), /保存場所へアクセスできません/);
  assert.equal(workCalls, 1);
  assert.notEqual(await getConnection(), database);
  const count = await withLocalTransaction(["notes"], "readonly", async (transaction) => readRequest(transaction.objectStore("notes").count()));
  assert.equal(count, 0);
});

test("入力検証など通常の失敗では接続を閉じない", async () => {
  const database = await getConnection();
  await assert.rejects(withLocalTransaction(["notes"], "readwrite", async () => { throw new Error("入力エラー"); }), /入力エラー/);
  assert.equal(await getConnection(), database);
});
