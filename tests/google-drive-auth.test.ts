import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import { createGoogleDriveAuth, GOOGLE_DRIVE_SCOPE } from "@/features/pdf-editor/googleDriveAuth";
import type { GoogleOAuth2, GoogleTokenClientConfig } from "@/features/pdf-editor/googleIdentity";

const clientId = "1234567890-overlay.apps.googleusercontent.com";
const response = { access_token: "test-token_A", token_type: "Bearer", expires_in: 3600, scope: GOOGLE_DRIVE_SCOPE };
const clients: ReturnType<typeof createGoogleDriveAuth>[] = [];
const descriptors = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  for (const name of ["indexedDB", "localStorage", "sessionStorage"]) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, get: () => { throw new Error("認証情報を永続保存しない"); } });
  }
  mock.method(globalThis, "fetch", () => { throw new Error("認証単体テストでGoogleへ通信しない"); });
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.disconnect());
  mock.timers.reset();
  mock.restoreAll();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  descriptors.clear();
});

function fixture(options: { clientId?: string; loadIdentity?: () => Promise<GoogleOAuth2>; now?: () => number } = {}) {
  const requests: GoogleTokenClientConfig[] = [];
  let popups = 0;
  let loads = 0;
  const identity: GoogleOAuth2 = { initTokenClient(config) {
    requests.push(config);
    return { requestAccessToken() { popups++; } };
  } };
  const client = createGoogleDriveAuth({ clientId,
    loadIdentity: async () => { loads++; return identity; }, ...options });
  clients.push(client);
  return { client, identity, requests, popups: () => popups, loads: () => loads };
}

async function authorize(f: ReturnType<typeof fixture>, token = response) {
  await f.client.prepare();
  const pending = f.client.connect();
  f.requests.at(-1)!.callback(token);
  await pending;
}

test("作成と状態参照だけではSDK取得・認証・永続保存・通信をしない", () => {
  const f = fixture();
  assert.deepEqual(f.client.getState(), { status: "unprepared", expiresAt: null, error: null });
  assert.equal(f.loads(), 0);
  assert.equal(f.popups(), 0);
  assert.throws(() => f.client.getAccessToken(), /再接続/);
});

test("未設定・不正なクライアントIDでは認証準備を開始しない", async () => {
  for (const id of ["", "not-a-client", "https://example.com/secret", "123.apps.googleusercontent.com/path"]) {
    const f = fixture({ clientId: id });
    await assert.rejects(f.client.prepare(), /クライアントID/);
    assert.equal(f.client.getState().status, "unconfigured");
    assert.equal(f.loads(), 0);
  }
});

test("準備は共有し、完了後のconnectは同期的に最小権限のポップアップを要求する", async () => {
  const f = fixture();
  await assert.rejects(f.client.connect(), /接続準備/);
  await Promise.all([f.client.prepare(), f.client.prepare()]);
  assert.equal(f.loads(), 1);
  assert.equal(f.client.getState().status, "disconnected");
  const pending = f.client.connect();
  assert.equal(f.popups(), 1); // awaitやmicrotaskより前、クリックの呼び出し内で要求する。
  assert.equal(f.client.getState().status, "authorizing");
  assert.equal(f.requests[0].client_id, clientId);
  assert.equal(f.requests[0].scope, GOOGLE_DRIVE_SCOPE);
  assert.equal(f.requests[0].include_granted_scopes, false);
  assert.equal(f.requests[0].prompt, "select_account");
  f.requests[0].callback(response);
  await pending;
  assert.equal(f.client.getState().status, "authorized");
  assert.equal(f.client.getAccessToken(), response.access_token);
  assert.ok(!JSON.stringify(f.client.getState()).includes(response.access_token));
});

test("期限の最大30秒前で再接続が必要になり、自動的に認証ポップアップを開かない", async () => {
  let clock = 1_000_000;
  const f = fixture({ now: () => clock });
  await authorize(f);
  assert.equal(f.client.getState().expiresAt, 4_570_000);
  clock = 4_569_999;
  assert.equal(f.client.getAccessToken(), response.access_token);
  clock++;
  assert.equal(f.client.getState().status, "reconnect-required");
  assert.equal(f.client.getState().expiresAt, null);
  assert.throws(() => f.client.getAccessToken(), /再接続/);
  assert.equal(f.popups(), 1);
  await authorize(f, { ...response, access_token: "new-token" });
  assert.equal(f.client.getAccessToken(), "new-token");
});

test("拒否・権限不足・不正な応答でトークンを保持せず、機密をエラーへ含めない", async () => {
  const f = fixture();
  await f.client.prepare();
  for (const value of [
    null, {}, { error: "access_denied", error_description: "secret-token" }, { error: "secret-token" },
    { ...response, scope: "https://www.googleapis.com/auth/drive" },
    { ...response, expires_in: 0 }, { ...response, expires_in: Infinity }, { ...response, expires_in: "invalid" },
    { ...response, token_type: "unknown" }, { ...response, access_token: "" },
    { ...response, access_token: "unsafe\r\nheader" },
  ]) {
    const pending = f.client.connect();
    f.requests.at(-1)!.callback(value);
    await assert.rejects(pending, (error: Error) => !error.message.includes("secret-token") && !error.cause);
    assert.equal(f.client.getState().status, "error");
    assert.equal(f.client.getState().expiresAt, null);
    assert.throws(() => f.client.getAccessToken(), /再接続/);
  }
});

test("ポップアップの拒否・閉じる操作・SDK例外の後も再試行できる", async () => {
  const f = fixture();
  await f.client.prepare();
  for (const type of ["popup_closed", "popup_failed_to_open", "unknown"]) {
    const pending = f.client.connect();
    f.requests.at(-1)!.error_callback({ type });
    await assert.rejects(pending, /閉じられました|ポップアップ|接続に失敗/);
  }
  const failure = mock.method(f.identity, "initTokenClient", () => { throw new Error("secret-token"); });
  await assert.rejects(f.client.connect(), /接続を開始できません/);
  assert.ok(!JSON.stringify(f.client.getState()).includes("secret-token"));
  failure.mock.restore();
  await authorize(f);
  assert.equal(f.client.getAccessToken(), response.access_token);
});

test("二重の接続要求を拒否し、最初の要求を別の要求で上書きしない", async () => {
  const f = fixture();
  await f.client.prepare();
  const first = f.client.connect();
  await assert.rejects(f.client.connect(), /接続操作中/);
  assert.equal(f.popups(), 1);
  f.requests[0].callback(response);
  await first;
});

test("切断後の古いコールバックは認可を復活させず、再接続後の状態も変更しない", async () => {
  const f = fixture();
  await f.client.prepare();
  const first = f.client.connect();
  const cancelled = assert.rejects(first, /キャンセル/);
  f.client.disconnect();
  await cancelled;
  assert.equal(f.client.getState().status, "disconnected");
  f.requests[0].callback(response);
  assert.throws(() => f.client.getAccessToken(), /再接続/);
  const second = f.client.connect();
  f.requests[1].callback({ ...response, access_token: "second-token" });
  await second;
  f.requests[0].error_callback({ type: "popup_closed" });
  f.requests[0].callback(response);
  assert.equal(f.client.getAccessToken(), "second-token");
});

test("再接続の開始で古いトークンを捨て、キャンセル後に前のアカウントへ戻さない", async () => {
  const f = fixture();
  await authorize(f);
  const next = f.client.connect();
  assert.throws(() => f.client.getAccessToken(), /再接続/);
  f.requests.at(-1)!.error_callback({ type: "popup_closed" });
  await assert.rejects(next);
  assert.throws(() => f.client.getAccessToken(), /再接続/);
});

test("以前のリクエストの失効通知で新しい認証情報を破棄しない", async () => {
  const f = fixture();
  await authorize(f);
  await authorize(f, { ...response, access_token: "new-token" });
  f.client.invalidateAccessToken(response.access_token);
  assert.equal(f.client.getAccessToken(), "new-token");
  f.client.invalidateAccessToken("new-token");
  assert.equal(f.client.getState().status, "reconnect-required");
  assert.throws(() => f.client.getAccessToken(), /再接続/);
});

test("SDK読み込み失敗から再試行でき、準備中の切断後に古い準備結果を採用しない", async () => {
  let resolve!: (api: GoogleOAuth2) => void;
  let failures = true;
  const f = fixture({ loadIdentity: () => failures ? Promise.reject(new Error("secret-token"))
    : new Promise<GoogleOAuth2>((done) => { resolve = done; }) });
  await assert.rejects(f.client.prepare(), /接続準備に失敗/);
  assert.ok(!JSON.stringify(f.client.getState()).includes("secret-token"));
  failures = false;
  const pending = f.client.prepare();
  await Promise.resolve();
  f.client.disconnect();
  const rejected = assert.rejects(pending, /キャンセル/);
  resolve(f.identity);
  await rejected;
  assert.equal(f.client.getState().status, "unprepared");
});

test("返答が来ない接続は時間切れで解除し、遅れた成功を採用しない", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  await f.client.prepare();
  const pending = f.client.connect();
  const rejected = assert.rejects(pending, /完了しませんでした/);
  mock.timers.tick(120_000);
  await rejected;
  f.requests[0].callback(response);
  assert.throws(() => f.client.getAccessToken(), /再接続/);
});

test("別インスタンスへトークンを共有せず、再作成は未認可から始まる", async () => {
  const f = fixture();
  await authorize(f);
  const next = fixture();
  assert.equal(next.client.getState().status, "unprepared");
  assert.throws(() => next.client.getAccessToken(), /再接続/);
  f.client.disconnect();
  assert.equal(f.client.getState().expiresAt, null);
});
