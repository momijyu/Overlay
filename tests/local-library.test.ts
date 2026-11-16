import assert from "node:assert/strict";
import test from "node:test";
import { createLocalLibrarySelector, LEGACY_LIBRARY_DATABASE } from "@/features/pdf-editor/localLibrary";
import { createDriveAccountLibraries } from "@/features/pdf-editor/driveAccountLibraries";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("アカウント別の保存先を切り替え、既存タブを固定し、元の保存先へ戻せる", () => {
  const local = storage(), tab = storage();
  const a = createLocalLibrarySelector(local, tab);
  a.rememberLegacyOwner("account-a");
  a.selectAccount("account-b");
  assert.equal(a.getDatabaseName(), LEGACY_LIBRARY_DATABASE);
  const b = createLocalLibrarySelector(local, tab);
  assert.equal(b.getDatabaseName(), "overlay-account-account-b");
  assert.equal(createLocalLibrarySelector(local, storage()).getDatabaseName(), b.getDatabaseName());
  b.selectAccount("account-a");
  assert.equal(b.getDatabaseName(), "overlay-account-account-b");
  assert.equal(createLocalLibrarySelector(local, tab).getDatabaseName(), LEGACY_LIBRARY_DATABASE);
});

test("不正なアカウント指定と既存所有者の変更を拒否する", () => {
  const selector = createLocalLibrarySelector(storage(), storage());
  selector.rememberLegacyOwner("a");
  assert.throws(() => selector.rememberLegacyOwner("b"));
  assert.throws(() => selector.selectAccount("../b"));
  assert.equal(selector.getExpectedAccount(), "a");
});

test("切り替え設定の一部が失敗した場合は元の選択へ戻す", () => {
  const local = storage(), tab = storage();
  const selector = createLocalLibrarySelector(local, tab);
  const previous = tab.getItem("overlay-tab-library-v1");
  const original = tab.setItem;
  tab.setItem = (key, value) => { if (value.includes('"b"')) throw new Error("容量不足"); original(key, value); };
  assert.throws(() => selector.selectAccount("b"), /容量不足/);
  assert.equal(local.getItem("overlay-active-library-v1"), null);
  assert.equal(tab.getItem("overlay-tab-library-v1"), previous);
});

test("既存の所有者を引き継ぎ、別アカウントは確認待ち、同じアカウントの保存先違いは拒否する", async () => {
  const selector = createLocalLibrarySelector(storage(), storage());
  const libraries = createDriveAccountLibraries(async () => ({ accountId: "a", rootId: "root-a" }), () => selector);
  assert.equal(await libraries.check("b", "root-b"), "switch");
  assert.equal(selector.getExpectedAccount(), "a");
  assert.equal(await libraries.check("a", "root-a"), "connect");
  await assert.rejects(libraries.check("a", "other-root"), /Overlayフォルダ/);
});

test("選択アカウントとDBの所有者が一致しなければ接続しない", async () => {
  const local = storage(), tab = storage();
  createLocalLibrarySelector(local, tab).selectAccount("b");
  const selector = createLocalLibrarySelector(local, tab);
  const libraries = createDriveAccountLibraries(async () => ({ accountId: "a", rootId: "root-a" }), () => selector);
  await assert.rejects(libraries.check("b", "root-b"), /一致しません/);
});
