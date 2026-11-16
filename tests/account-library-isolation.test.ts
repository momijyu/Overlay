import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import { IDBFactory } from "fake-indexeddb";

let databaseName = "overlay-local-notes";
mock.module("@/features/pdf-editor/localLibrary", { namedExports: { getLocalDatabaseName: () => databaseName } });
const { readRequest, withLocalTransaction } = await import("@/features/pdf-editor/localDatabase");
const { getStoredDriveIdentity, LIBRARY_STORES } = await import("@/features/pdf-editor/driveLibraryLocal");

beforeEach(() => {
  databaseName = "overlay-local-notes";
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
});

async function seed(value: string) {
  await withLocalTransaction([...LIBRARY_STORES], "readwrite", async (tx) => {
    await Promise.all(LIBRARY_STORES.map((name) => readRequest(tx.objectStore(name).put({ id: "same-id", value }))));
  }, false);
}
async function contents() {
  return withLocalTransaction([...LIBRARY_STORES], "readonly", async (tx) => Promise.all(
    LIBRARY_STORES.map((name) => readRequest(tx.objectStore(name).getAll())),
  ));
}

test("全ストアの同一IDをアカウント間で分離し、切り替え後も元PDF・未送信データを保持する", async () => {
  await seed("a");
  const original = await contents();
  databaseName = "overlay-account-b";
  assert.deepEqual(await contents(), LIBRARY_STORES.map(() => []));
  await seed("b");
  const other = await contents();
  databaseName = "overlay-local-notes";
  assert.deepEqual(await contents(), original);
  databaseName = "overlay-account-b";
  assert.deepEqual(await contents(), other);
});

test("無効化済みの旧送信記録からも所有者を識別し、混在した所有者は拒否する", async () => {
  await withLocalTransaction(["driveBindings"], "readwrite", async (tx) => {
    await readRequest(tx.objectStore("driveBindings").put({ id: "a", accountId: "owner", rootId: "root", enabled: false }));
  }, false);
  assert.deepEqual(await getStoredDriveIdentity(), { accountId: "owner", rootId: "root" });
  await withLocalTransaction(["driveBindings"], "readwrite", async (tx) => {
    await readRequest(tx.objectStore("driveBindings").put({ id: "b", accountId: "other", rootId: "root" }));
  }, false);
  await assert.rejects(getStoredDriveIdentity(), /一致しません/);
});
