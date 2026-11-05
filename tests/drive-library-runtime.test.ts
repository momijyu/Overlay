import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { mock } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { getLibraryScope, enableDriveLibrary } from "@/features/pdf-editor/driveLibraryLocal";
import { createNoteFolder, saveLocalNote } from "@/features/pdf-editor/localNotes";
import { listDriveBindings } from "@/features/pdf-editor/driveOutbox";

type Connection = { account: { id: string }; root: { id: string } | null };
let connection: Connection | null;
let actualAccount: string;
let token: string;
let accountChecks = 0;
let syncs = 0;
let loseConnection = false;
const session = { getConnection: () => connection, auth: { getAccessToken: () => token } };
mock.module("@/features/pdf-editor/googleDriveSession", { exports: { getGoogleDriveSession: () => session } });
mock.module("@/features/pdf-editor/googleDriveClient", { exports: { createGoogleDriveClient: () => ({
  async getAccount() { accountChecks++; if (loseConnection) connection = null; return { id: actualAccount }; },
  async autosaveAccess() { return {}; }, dispose() {},
}) } });
mock.module("@/features/pdf-editor/driveAutosave", { exports: { createBrowserDriveAutosave: () => ({ async tick() {}, dispose() {} }) } });
mock.module("@/features/pdf-editor/driveLibraryRemote", { exports: { async syncDriveLibrary() { syncs++; } } });
mock.module("@/features/pdf-editor/driveLibraryCache", { exports: { async pruneDriveCache() {} } });
const { createBrowserDriveLibrary } = await import("@/features/pdf-editor/driveLibraryRuntime");
beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { async request(_name: string, _options: unknown, work: (lock: object) => Promise<void>) { await work({}); } } } });
  connection = { account: { id: "account" }, root: { id: "root" } };
  actualAccount = "account"; token = "token"; accountChecks = 0; syncs = 0; loseConnection = false;
});

test("接続先確認後、ノート未選択でも全既存ノートを自動登録し、新規ノートも対象にする", async () => {
  const file = new File(["%PDF-1.7\nfixture"], "講義.pdf", { type: "application/pdf" });
  await createNoteFolder("講義", null);
  const first = await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  const runner = createBrowserDriveLibrary(); await runner.tick();
  assert.equal((await getLibraryScope())?.accountId, "account");
  assert.equal((await listDriveBindings())[0].id, first);
  await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  assert.equal((await listDriveBindings()).length, 2);
  const keys = (await listDriveBindings()).map((row) => row.key);
  await runner.tick();
  assert.deepEqual((await listDriveBindings()).map((row) => row.key), keys);
  assert.equal(accountChecks, 1); assert.ok(syncs > 0); runner.dispose();
});

test("未接続・Overlayフォルダ未選択では登録・同期しない", async () => {
  connection = null; const runner = createBrowserDriveLibrary(); await runner.tick();
  connection = { account: { id: "account" }, root: null }; await runner.tick();
  assert.equal(await getLibraryScope(), null); assert.equal(syncs, 0); assert.equal(accountChecks, 0); runner.dispose();
});

test("実アカウント照合の不一致・照合中の切断では自動登録しない", async () => {
  actualAccount = "different"; const runner = createBrowserDriveLibrary();
  await assert.rejects(runner.tick(), /アカウント/);
  assert.equal(await getLibraryScope(), null);
  actualAccount = "account"; loseConnection = true;
  await runner.tick(true);
  assert.equal(await getLibraryScope(), null); assert.equal(syncs, 0); runner.dispose();
});

test("別アカウントへの接続では既存の連携先を変更せず停止する", async () => {
  await enableDriveLibrary("original", "originalRoot");
  const runner = createBrowserDriveLibrary(); await assert.rejects(runner.tick(), /再接続/);
  assert.equal((await getLibraryScope())?.accountId, "original"); assert.equal(syncs, 0); runner.dispose();
});

test("同じアカウントへの再接続は認可を再検証し、同じライブラリで再開する", async () => {
  const runner = createBrowserDriveLibrary(); await runner.tick(); const scope = await getLibraryScope();
  connection = null; await runner.tick();
  connection = { account: { id: "account" }, root: { id: "root" } }; token = "renewed";
  await runner.tick(true);
  assert.equal((await getLibraryScope())?.deviceId, scope?.deviceId); assert.equal(accountChecks, 2); assert.equal(syncs, 2); runner.dispose();
});
