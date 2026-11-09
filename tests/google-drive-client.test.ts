import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import { createGoogleDriveClient } from "@/features/pdf-editor/googleDriveClient";
import { speedMeasurements } from "@/features/pdf-editor/speedMeasurements";

const user = { permissionId: "account_A", displayName: "Test User", emailAddress: "test@example.com", me: true };
const folder = { id: "folder_A", name: "Overlay", mimeType: "application/vnd.google-apps.folder", ownedByMe: true, trashed: false,
  appProperties: { overlayApp: "overlay", overlayRole: "root", overlaySchema: "1" } };
type Reply = (url: string, init: RequestInit) => Promise<Response>;
const json = (value: unknown, status = 200) => async () => Response.json(value, { status });
const clients: ReturnType<typeof createGoogleDriveClient>[] = [];
afterEach(() => { clients.splice(0).forEach((client) => client.dispose()); mock.timers.reset(); speedMeasurements.clear(); });

function fixture() {
  let token: string | null = "token_A";
  const replies: Reply[] = [];
  const requests: { url: URL; init: RequestInit }[] = [];
  const invalidated: string[] = [];
  const listeners = new Set<() => void>();
  const auth = { getAccessToken() { if (!token) throw new Error("再接続してください。"); return token; },
    invalidateAccessToken(value: string) { invalidated.push(value); if (value === token) { token = null; listeners.forEach((listener) => listener()); } },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const requestFetch = (async (url: string, init: RequestInit) => {
    requests.push({ url: new URL(url), init });
    const reply = replies.shift();
    assert.ok(reply, "予定していない通信をしない");
    return reply(url, init);
  }) as typeof fetch;
  const newClient = () => { const client = createGoogleDriveClient(auth, requestFetch); clients.push(client); return client; };
  const client = newClient();
  return { client, newClient, replies, requests, invalidated,
    changeToken: (value: string | null) => { token = value; listeners.forEach((listener) => listener()); } };
}

async function verify(f: ReturnType<typeof fixture>) {
  f.replies.push(json({ user }));
  return f.client.getAccount();
}

test("作成だけでは通信せず、確認前・別アカウント指定ではフォルダを操作しない", async () => {
  const f = fixture();
  assert.equal(f.requests.length, 0);
  await assert.rejects(f.client.findRoot(user.permissionId), /接続確認/);
  await assert.rejects(f.client.createRoot(user.permissionId), /接続確認/);
  await verify(f);
  await assert.rejects(f.client.createRoot("account_B"), /接続確認/);
  assert.equal(f.requests.length, 1);
});

test("HTTP計測は応答待ちと本文受信を区別し、通信回数・応答値・エラー処理を変えない", async () => {
  const f = fixture(); speedMeasurements.start();
  assert.equal((await verify(f)).id, user.permissionId);
  f.replies.push(json({}, 403)); await assert.rejects(f.client.findRoot(user.permissionId), /アクセス/);
  const snapshot = speedMeasurements.stop();
  const report = { ...snapshot, records: snapshot.records.filter(row => row.phase === "drive.http") };
  assert.equal(f.requests.length, 2); assert.equal(report.records.length, 2);
  assert.deepEqual(report.records.map((row) => row.info.httpStatus), [200, 403]);
  assert.deepEqual(report.records.map((row) => row.outcome), ["ok", "error"]);
  assert.equal(report.records[0].info.requestKind, "account");
  assert.equal(typeof report.records[0].info.headersMs, "number"); assert.equal(typeof report.records[0].info.bodyMs, "number");
  assert.doesNotMatch(JSON.stringify(report), /account_A|token_A|test@example|Test User|googleapis/);
  speedMeasurements.start(); f.replies.push(async () => { throw new Error("private-network-error"); });
  await assert.rejects(f.client.getAccount());
  const failed = speedMeasurements.stop().records.find(row => row.phase === "drive.http")!;
  assert.equal(failed.info.httpStatus, 0); assert.equal(failed.info.bodyMs, 0);
  assert.doesNotMatch(JSON.stringify(failed), /private-network-error/);
});

test("APIの本人情報でアカウントを確認し、トークンはヘッダー以外に渡さない", async () => {
  const f = fixture();
  assert.deepEqual(await verify(f), { id: user.permissionId, displayName: user.displayName, emailAddress: user.emailAddress });
  const { url, init } = f.requests[0];
  assert.equal(url.origin, "https://www.googleapis.com");
  assert.equal(url.pathname, "/drive/v3/about");
  assert.equal(url.searchParams.get("fields"), "user(permissionId,displayName,emailAddress,me)");
  assert.equal((init.headers as Record<string, string>).Authorization, "Bearer token_A");
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  assert.equal(init.cache, "no-store");
  assert.ok(!url.toString().includes("token_A"));
  assert.equal(init.body, undefined);
});

test("本人でない・壊れたアカウント応答は採用せず、後続の書き込みを拒否する", async () => {
  for (const value of [null, {}, { user: { ...user, me: false } }, { user: { ...user, permissionId: "" } },
    { user: { ...user, displayName: "unsafe\nname" } }]) {
    const f = fixture();
    f.replies.push(json(value));
    await assert.rejects(f.client.getAccount(), /応答/);
    await assert.rejects(f.client.createRoot(user.permissionId), /接続確認/);
    assert.equal(f.requests.length, 1);
  }
});

test("検索は専用の目印・所有者・ルート・フォルダ種別に限定し、見つからなくても作成しない", async () => {
  const f = fixture(); await verify(f);
  f.replies.push(json({ files: [] }));
  assert.equal(await f.client.findRoot(user.permissionId), null);
  const { url, init } = f.requests[1];
  const query = url.searchParams.get("q")!;
  for (const term of ["trashed = false", "'root' in parents", "'me' in owners", "overlayApp", "overlayRole", "application/vnd.google-apps.folder"]) {
    assert.ok(query.includes(term));
  }
  assert.equal(url.searchParams.get("spaces"), "drive");
  assert.equal(url.searchParams.get("corpora"), "user");
  assert.equal(init.method, "GET");
  assert.equal(f.requests.length, 2);
});

test("ユーザーが改名した専用フォルダを再利用し、余分なフォルダを作らない", async () => {
  const f = fixture(); await verify(f);
  f.replies.push(json({ files: [{ ...folder, name: "大学の資料" }] }));
  assert.deepEqual(await f.client.createRoot(user.permissionId), { id: folder.id, name: "大学の資料" });
  assert.ok(f.requests.every((request) => request.init.method === "GET"));
});

test("明示的な作成でのみメタデータを送信し、ローカルPDF・共有権限を送らない", async () => {
  const f = fixture(); await verify(f);
  f.replies.push(json({ files: [] }), json(folder), json({ files: [folder] }));
  assert.deepEqual(await f.client.createRoot(user.permissionId), { id: folder.id, name: folder.name });
  assert.equal(f.requests.length, 4);
  const { url, init } = f.requests[2];
  assert.equal(url.pathname, "/drive/v3/files");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(String(init.body)), { name: "Overlay", mimeType: folder.mimeType, parents: ["root"], appProperties: folder.appProperties });
  assert.equal((init.headers as Record<string, string>)["Content-Type"], "application/json");
});

test("重複・検索未完了・一般の同名フォルダ・未知の形式では自動採用も作成もしない", async () => {
  const values = [{ files: [folder, { ...folder, id: "folder_B" }] }, { files: [folder], nextPageToken: "next" },
    { files: [], incompleteSearch: true }, { files: [{ ...folder, appProperties: {} }] },
    { files: [{ ...folder, ownedByMe: false }] }, { files: [{ ...folder, trashed: true }] },
    { files: [{ ...folder, appProperties: { ...folder.appProperties, overlaySchema: "99" } }] },
    { files: [{ ...folder, id: "https://example.com/folder" }] }, {}];
  for (const value of values) {
    const f = fixture(); await verify(f); f.replies.push(json(value));
    await assert.rejects(f.client.createRoot(user.permissionId));
    assert.ok(f.requests.every((request) => request.init.method === "GET"));
  }
});

test("作成が重なった場合は重複を報告し、勝手な削除や統合をしない", async () => {
  const f = fixture(); await verify(f);
  f.replies.push(json({ files: [] }), json(folder), json({ files: [folder, { ...folder, id: "folder_B" }] }));
  await assert.rejects(f.client.createRoot(user.permissionId), /複数/);
  assert.equal(f.requests.filter((request) => request.init.method === "POST").length, 1);
  assert.ok(f.requests.every((request) => ["GET", "POST"].includes(String(request.init.method))));
});

test("アカウントの再認可後は確認をやり直すまでフォルダへ触れない", async () => {
  const f = fixture(); await verify(f); f.changeToken("token_B");
  await assert.rejects(f.client.createRoot(user.permissionId), /接続確認/);
  assert.equal(f.requests.length, 1);
  f.replies.push(json({ user: { ...user, permissionId: "account_B" } }));
  await f.client.getAccount();
  await assert.rejects(f.client.createRoot(user.permissionId), /接続確認/);
});

test("応答待ちにアカウントが変わっても、古い結果や401で新しいトークンを失効させない", async () => {
  for (const status of [200, 401]) {
    const f = fixture(); await verify(f);
    f.replies.push(async () => { f.changeToken("token_B"); return Response.json({ files: [folder] }, { status }); });
    await assert.rejects(f.client.findRoot(user.permissionId), /変更/);
    assert.deepEqual(f.invalidated, []);
    assert.equal(f.requests.length, 2);
  }
});

test("JSONの読み取り中に認証が失効した場合もアカウントを採用しない", async () => {
  const f = fixture();
  f.replies.push(async () => ({ ok: true, status: 200, json: async () => { f.changeToken(null); return { user }; } }) as Response);
  await assert.rejects(f.client.getAccount(), /再接続/);
  f.changeToken("token_A");
  await assert.rejects(f.client.createRoot(user.permissionId), /接続確認/);
});

test("401は再接続へ、403は設定確認へ案内し、Googleのエラー本文を公開しない", async () => {
  for (const status of [401, 403, 429, 500]) {
    const f = fixture();
    f.replies.push(json({ error: { message: "private-token-and-details" } }, status));
    await assert.rejects(f.client.getAccount(), (error: Error) => {
      assert.ok(!error.message.includes("private-token-and-details")); assert.equal(error.cause, undefined);
      assert.match(error.message, status === 401 ? /再接続/ : status === 403 ? /アクセス権/ : /再試行/); return true;
    });
    assert.deepEqual(f.invalidated, status === 401 ? ["token_A"] : []);
    assert.equal(f.requests.length, 1);
  }
});

test("作成時の通信断は結果不明を案内し、自動でPOSTを繰り返さない", async () => {
  const f = fixture(); await verify(f);
  f.replies.push(json({ files: [] }), async () => { throw new Error("private-token"); });
  await assert.rejects(f.client.createRoot(user.permissionId), /再検索/);
  assert.equal(f.requests.length, 3);
});

test("作成中の二重要求は拒否し、最初の処理を維持する", async () => {
  const f = fixture(); await verify(f);
  let release!: (response: Response) => void;
  f.replies.push(() => new Promise((resolve) => { release = resolve; }), json(folder), json({ files: [folder] }));
  const first = f.client.createRoot(user.permissionId);
  await assert.rejects(f.client.createRoot(user.permissionId), /作成中/);
  release(Response.json({ files: [] }));
  await first;
  assert.equal(f.requests.filter((request) => request.init.method === "POST").length, 1);
});

test("閉じる操作は通信を中断し、無視して返った古い結果も採用しない", async () => {
  const f = fixture();
  let release!: (response: Response) => void;
  f.replies.push(() => new Promise((resolve) => { release = resolve; }));
  const pending = f.client.getAccount();
  const signal = f.requests[0].init.signal!;
  f.client.dispose();
  assert.equal(signal.aborted, true);
  release(Response.json({ user }));
  await assert.rejects(pending, /キャンセル/);
  await assert.rejects(f.client.getAccount(), /キャンセル/);
  assert.equal(f.requests.length, 1);
});

test("応答がない通信を30秒で中断し、再試行で新しい要求を送れる", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.replies.push(async (_url, init) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new Error("private-token")), { once: true });
  }));
  const pending = f.client.getAccount();
  const rejected = assert.rejects(pending, /再試行/);
  mock.timers.tick(30_000);
  await rejected;
  assert.deepEqual(await verify(f), { id: user.permissionId, displayName: user.displayName, emailAddress: user.emailAddress });
});


test("専用フォルダの重複時はデータを変えず、削除せずに復旧する手順を案内する", async () => {
  const f = fixture(); await verify(f);
  f.replies.push(json({ files: [folder, { ...folder, id: "folder_B" }] }));
  await assert.rejects(f.client.findRoot(user.permissionId), /マイドライブ直下に1つ残し.*別の場所へ移動.*再接続/);
  assert.ok(f.requests.every((request) => request.init.method === "GET"));
});

async function warm(f: ReturnType<typeof fixture>) {
  await verify(f); f.replies.push(json({ files: [folder] }));
  await f.client.findRoot(user.permissionId);
}

test("同じ認可の別インスタンスは完了済みの接続確認を共有し、応答オブジェクトの変更を持ち込まない", async () => {
  const f = fixture(); await warm(f);
  const next = f.newClient();
  const account = await next.getAccount({ reuseConfirmed: true }); account.id = "changed";
  await next.autosaveAccess(user.permissionId, folder.id);
  assert.equal(f.requests.length, 2);
  assert.equal((await next.getAccount({ reuseConfirmed: true })).id, user.permissionId);
  await assert.rejects(next.autosaveAccess("other-account", folder.id), /接続確認/);
  f.replies.push(json({ files: [{ ...folder, id: "other-root" }] }));
  await assert.rejects(next.autosaveAccess(user.permissionId, folder.id + "_other"), /変更/);
  assert.equal(f.requests.length, 3);
});

test("共有結果は取得から30秒で失効し、利用しても期限を延長しない", async () => {
  let now = 1000; mock.method(Date, "now", () => now);
  const f = fixture(); await warm(f); const next = f.newClient();
  now += 29999;
  await next.getAccount({ reuseConfirmed: true }); await next.autosaveAccess(user.permissionId, folder.id);
  assert.equal(f.requests.length, 2);
  now++;
  f.replies.push(json({ user }), json({ files: [folder] }));
  await next.getAccount({ reuseConfirmed: true }); await next.autosaveAccess(user.permissionId, folder.id);
  assert.equal(f.requests.length, 4);
});

test("同じトークン文字列でも別の認可オブジェクトとは確認を共有しない", async () => {
  const f = fixture(); await warm(f); const other = fixture();
  other.replies.push(json({ user }), json({ files: [folder] }));
  await other.client.getAccount({ reuseConfirmed: true }); await other.client.autosaveAccess(user.permissionId, folder.id);
  assert.equal(f.requests.length, 2); assert.equal(other.requests.length, 2);
});

test("認可の変更・失効通知では共有確認を破棄し、同じトークンで再接続しても再確認する", async () => {
  const f = fixture(); await warm(f); const next = f.newClient();
  f.changeToken("token_B");
  f.replies.push(json({ user }), json({ files: [folder] }));
  await next.getAccount({ reuseConfirmed: true }); await next.autosaveAccess(user.permissionId, folder.id);
  assert.equal(f.requests.length, 4);
  f.changeToken(null); f.changeToken("token_B");
  f.replies.push(json({ user }), json({ files: [folder] }));
  await next.getAccount({ reuseConfirmed: true }); await next.autosaveAccess(user.permissionId, folder.id);
  assert.equal(f.requests.length, 6);
});

test("明示的な接続・ルート再確認は共有結果を使わず、失敗後は古い結果へ戻らない", async () => {
  const f = fixture(); await warm(f); const next = f.newClient();
  await next.getAccount({ reuseConfirmed: true });
  f.replies.push(json({ user })); await f.client.getAccount();
  assert.equal(f.requests.length, 3);
  f.replies.push(json({ files: [folder] })); await next.autosaveAccess(user.permissionId, folder.id);
  f.replies.push(json({}, 403)); await assert.rejects(f.client.findRoot(user.permissionId));
  f.replies.push(json({ files: [] })); await assert.rejects(next.autosaveAccess(user.permissionId, folder.id), /変更/);
  assert.equal(f.requests.length, 6);
  f.replies.push(json({}, 403)); await assert.rejects(f.client.getAccount());
  f.replies.push(json({ user })); await next.getAccount({ reuseConfirmed: true });
  assert.equal(f.requests.length, 8);
});

test("別インスタンスを閉じても進行中の通信を中断せず、完了結果で保存を続けられる", async () => {
  const f = fixture(); await warm(f); const next = f.newClient();
  await next.getAccount({ reuseConfirmed: true });
  const access = await next.autosaveAccess(user.permissionId, folder.id);
  let release!: (response: Response) => void;
  f.replies.push(() => new Promise((resolve) => { release = resolve; }));
  const pending = access.json("files/test-note", {}); const signal = f.requests.at(-1)!.init.signal!;
  f.client.cancelPending(); assert.equal(signal.aborted, false);
  release(Response.json({ id: "test-note" })); assert.deepEqual(await pending, { id: "test-note" });
  f.replies.push(json({ files: [folder] })); await next.autosaveAccess(user.permissionId, folder.id);
  assert.equal(f.requests.length, 4);
});

test("再確認中のキャンセル後に届いた結果を共有キャッシュへ戻さない", async () => {
  const f = fixture(); await warm(f); const next = f.newClient(); await next.getAccount({ reuseConfirmed: true });
  let release!: (response: Response) => void;
  f.replies.push(() => new Promise((resolve) => { release = resolve; }));
  const pending = f.client.findRoot(user.permissionId);
  f.client.cancelPending(); release(Response.json({ files: [folder] }));
  await assert.rejects(pending, /キャンセル/);
  f.replies.push(json({ files: [] })); await assert.rejects(next.autosaveAccess(user.permissionId, folder.id), /変更/);
  assert.equal(f.requests.length, 4);
});


test("接続共有の利用・期限切れ・明示確認を区別して記録し、IDや認証情報は含めない", async () => {
  let now = 1000; mock.method(Date, "now", () => now);
  const f = fixture(); speedMeasurements.start(); await warm(f);
  const next = f.newClient();
  await next.getAccount({ reuseConfirmed: true }); await next.autosaveAccess(user.permissionId, folder.id);
  now += 30000;
  f.replies.push(json({ files: [folder] })); await next.autosaveAccess(user.permissionId, folder.id);
  f.replies.push(json({ user }), json({ files: [folder] }));
  await next.getAccount({ reuseConfirmed: true }); await next.autosaveAccess(user.permissionId, folder.id);
  const result = speedMeasurements.stop();
  assert.deepEqual(result.records.filter(r => r.phase === "drive.connection").map(r => r.info.connectionCheck),
    ["account-explicit", "root-explicit", "account-hit", "root-hit", "root-expired", "account-expired", "root-missing"]);
  assert.equal(f.requests.length, 5);
  assert.doesNotMatch(JSON.stringify(result), /account_A|token_A|test@example|Test User|googleapis/);
});
