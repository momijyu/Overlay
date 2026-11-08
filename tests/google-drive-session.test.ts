import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import type { GoogleTokenClientConfig } from "@/features/pdf-editor/googleIdentity";

let callbacks: GoogleTokenClientConfig[] = [];
let now = 0;
let popups = 0;
const modules: typeof import("@/features/pdf-editor/googleDriveSession")[] = [];
const sessions: ReturnType<typeof modules[number]["createGoogleDriveSession"]>[] = [];
let previousWindow: PropertyDescriptor | undefined;
let previousDocument: PropertyDescriptor | undefined;
let previousClientId: string | undefined;
function browserWindow() {
  return { isSecureContext: true, google: { accounts: { oauth2: { initTokenClient(config: GoogleTokenClientConfig) {
    callbacks.push(config); return { requestAccessToken() { popups++; } };
  } } } } };
}
const storageDescriptors = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  callbacks = []; now = 0; popups = 0;
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  previousClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "fixture.apps.googleusercontent.com";
  Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow() });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
  mock.method(Date, "now", () => now);
  mock.method(globalThis, "fetch", () => { throw new Error("実Googleへ接続しない"); });
  for (const key of ["indexedDB", "localStorage", "sessionStorage"]) {
    storageDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, get() { throw new Error("認証情報を永続保存しない"); } });
  }
});
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose()); mock.restoreAll();
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
  if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument); else Reflect.deleteProperty(globalThis, "document");
  if (previousClientId === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID; else process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = previousClientId;
  for (const [key, descriptor] of storageDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  storageDescriptors.clear();
});
async function freshModule() {
  // 非Reactモジュールが再評価されても、既に動いている自動保存と設定画面が同じ接続を参照する。
  const url = new URL(`../src/features/pdf-editor/googleDriveSession.ts?reload=${modules.length}`, import.meta.url);
  const value = await import(url.href) as typeof import("@/features/pdf-editor/googleDriveSession");
  modules.push(value); return value;
}
async function connected(session: ReturnType<typeof modules[number]["createGoogleDriveSession"]>) {
  sessions.push(session); await session.auth.prepare();
  const pending = session.auth.connect();
  callbacks.at(-1)!.callback({ access_token: "test-token", token_type: "Bearer", expires_in: 3600,
    scope: "https://www.googleapis.com/auth/drive.file" });
  await pending;
  session.remember({ id: "account", displayName: "User", emailAddress: "test@example.com" }, { id: "root", name: "Overlay" });
}

test("モジュール再評価後の設定画面と既存自動保存は同じブラウザ内の接続を共有する", async () => {
  const before = await freshModule(); const runnerSession = before.getGoogleDriveSession();
  await connected(runnerSession);
  const after = await freshModule(); const dialogSession = after.getGoogleDriveSession();
  assert.equal(dialogSession, runnerSession);
  assert.equal(dialogSession.getConnection()?.root?.id, "root");
  assert.equal(popups, 1);
});

test("認可失効を購読者へ通知し、古い接続情報を返さず、トークンを公開しない", async () => {
  const session = (await freshModule()).createGoogleDriveSession(); await connected(session);
  let changes = 0; const unsubscribe = session.subscribe(() => { changes++; });
  session.auth.invalidateAccessToken("unrelated-token"); assert.equal(changes, 0);
  session.auth.invalidateAccessToken("test-token");
  assert.equal(changes, 1); assert.equal(session.getConnection(), null);
  assert.throws(() => session.auth.getAccessToken(), /再接続/);
  unsubscribe();
});

test("期限切れと再接続を同じ購読で追跡し、別のブラウザページには接続を渡さない", async () => {
  const sessionModule = await freshModule(); const original = sessionModule.getGoogleDriveSession(); await connected(original);
  let expired = false; const unsubscribe = original.subscribe(() => { expired ||= original.getConnection() === null; });
  now = 3600000; assert.equal(original.getConnection(), null); assert.equal(expired, true);
  await connected(original); assert.equal(original.getConnection()?.account.id, "account");
  Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow() });
  const another = sessionModule.getGoogleDriveSession(); sessions.push(another);
  assert.notEqual(another, original); assert.equal(another.getConnection(), null); unsubscribe();
});

test("OAuthクライアント設定が変われば古い認可を使わず、新しい接続確認を必要とする", async () => {
  const sessionModule = await freshModule(); const original = sessionModule.getGoogleDriveSession(); await connected(original);
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "changed.apps.googleusercontent.com";
  const next = sessionModule.getGoogleDriveSession(); sessions.push(next);
  assert.notEqual(next, original); assert.equal(original.getConnection(), null); assert.equal(next.getConnection(), null);
  assert.throws(() => original.auth.getAccessToken(), /再接続/); assert.equal(popups, 1);
});
