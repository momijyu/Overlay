import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { mock } from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { getLibraryScope, enableDriveLibrary } from "@/features/pdf-editor/driveLibraryLocal";
import { createNoteFolder, saveLocalNote } from "@/features/pdf-editor/localNotes";
import { listDriveBindings } from "@/features/pdf-editor/driveOutbox";
import { DriveStickyIndexError } from "@/features/pdf-editor/driveStickyIndexData";

type Connection = { account: { id: string }; root: { id: string } | null };
let connection: Connection | null;
let actualAccount: string;
let token: string;
let accountChecks = 0;
let syncs = 0; let prunes = 0;
let autosaves = 0; let failSticky = false;
let stickyWait: Promise<void> | null = null;
let loseConnection = false;
const session = { getConnection: () => connection, auth: { getAccessToken: () => token } };
mock.module("@/features/pdf-editor/googleDriveSession", { exports: { getGoogleDriveSession: () => session } });
mock.module("@/features/pdf-editor/googleDriveClient", { exports: { createGoogleDriveClient: () => ({
  async getAccount() { accountChecks++; if (loseConnection) connection = null; return { id: actualAccount }; },
  async autosaveAccess() { return {}; }, dispose() {},
}) } });
mock.module("@/features/pdf-editor/driveAutosave", { exports: { createBrowserDriveAutosave: () => ({ async tick() { autosaves++; }, dispose() {} }) } });
mock.module("@/features/pdf-editor/driveLibraryRemote", { exports: {
  async syncDriveLibrary() { syncs++; },
  async syncDriveStickyIndexes() { if (stickyWait) await stickyWait; if (failSticky) throw new DriveStickyIndexError(new Error("索引取得失敗")); },
} });
mock.module("@/features/pdf-editor/driveLibraryCache", { exports: { async pruneDriveCache() { prunes++; } } });
const { createBrowserDriveLibrary } = await import("@/features/pdf-editor/driveLibraryRuntime");
beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { async request(_name: string, _options: unknown, work: (lock: object) => Promise<void>) { await work({}); } } } });
  connection = { account: { id: "account" }, root: { id: "root" } };
  actualAccount = "account"; token = "token"; accountChecks = 0; syncs = 0; prunes = 0; autosaves = 0; failSticky = false; stickyWait = null; loseConnection = false; mock.restoreAll();
});

test("付箋索引の失敗は案内を保持しつつ本文の自動保存を継続し、再試行の成功で解除する", async () => {
  failSticky = true;
  const runner = createBrowserDriveLibrary();
  try { await runner.tick(); } catch (error) { assert.ok(error instanceof DriveStickyIndexError); }
  await new Promise(setImmediate);
  assert.equal(autosaves, 1);
  await assert.rejects(runner.tick(), /付箋一覧を更新できません/);
  assert.equal(autosaves, 2); assert.equal(syncs, 1);
  failSticky = false;
  try { await runner.tick(true); } catch (error) { assert.ok(error instanceof DriveStickyIndexError); }
  await new Promise(setImmediate); assert.equal(await runner.tick(), true);
  assert.equal(autosaves, 4); assert.equal(syncs, 2); runner.dispose();
});

test("索引の取得が遅くても本文の自動保存と次のハートビートを待たせない", async () => {
  let release!: () => void; stickyWait = new Promise<void>((resolve) => { release = resolve; });
  const runner = createBrowserDriveLibrary();
  try {
    assert.equal(await runner.tick(), true); assert.equal(autosaves, 1);
    assert.equal(await runner.tick(), true); assert.equal(autosaves, 2);
  } finally { release(); await new Promise(setImmediate); runner.dispose(); }
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


test("待機中の時刻確認では階層全件を走査せず、キャッシュ整理は30秒ごとに制限する", async () => {
  let now = Date.now(); mock.method(Date, "now", () => now);
  const runner = createBrowserDriveLibrary(); await runner.tick();
  const getAll = IDBObjectStore.prototype.getAll; const scans: string[] = [];
  mock.method(IDBObjectStore.prototype, "getAll", function (this: IDBObjectStore, ...args: Parameters<typeof getAll>) {
    scans.push(this.name); return getAll.apply(this, args);
  });
  for (let i = 0; i < 5; i++) { now += 1000; await runner.tick(); }
  assert.deepEqual(scans, []); assert.equal(prunes, 1); assert.equal(syncs, 1);
  now += 30000; await runner.tick(); assert.equal(prunes, 2); assert.equal(syncs, 2);
  runner.dispose(); mock.restoreAll();
});
