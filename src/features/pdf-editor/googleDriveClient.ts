// この段階ではアカウント確認と専用フォルダ準備だけを扱う。ノートの送信・更新はしない。
type DriveAuthorization = { getAccessToken: () => string; invalidateAccessToken: (token: string) => void };
export type GoogleDriveAccount = { id: string; displayName: string; emailAddress: string };
export type GoogleDriveRoot = { id: string; name: string };
const FOLDER_TYPE = "application/vnd.google-apps.folder";
const ROOT_PROPERTIES = { overlayApp: "overlay", overlayRole: "root", overlaySchema: "1" };
const ROOT_FIELDS = "id,name,mimeType,appProperties,ownedByMe,trashed";
const ROOT_QUERY = "trashed = false and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and 'me' in owners"
  + " and appProperties has { key='overlayApp' and value='overlay' }"
  + " and appProperties has { key='overlayRole' and value='root' }";
const INVALID_RESPONSE = "Google Driveの応答を確認できませんでした。接続確認をやり直してください。";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(INVALID_RESPONSE);
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(INVALID_RESPONSE);
  }
  return value;
}

function root(value: unknown): GoogleDriveRoot {
  const item = object(value);
  const properties = object(item.appProperties);
  const id = text(item.id, 256);
  if (!/^[A-Za-z0-9_-]+$/.test(id) || item.mimeType !== FOLDER_TYPE || item.ownedByMe !== true
    || item.trashed !== false || properties.overlayApp !== ROOT_PROPERTIES.overlayApp
    || properties.overlayRole !== ROOT_PROPERTIES.overlayRole || properties.overlaySchema !== ROOT_PROPERTIES.overlaySchema) {
    throw new Error(INVALID_RESPONSE);
  }
  return { id, name: text(item.name, 1024) };
}

export function createGoogleDriveClient(auth: DriveAuthorization, requestFetch: typeof fetch = (...args) => fetch(...args)) {
  let verified: { token: string; accountId: string } | null = null;
  let disposed = false;
  let creating = false;
  const pending = new Set<AbortController>();

  function currentToken() {
    if (disposed) throw new Error("Google Driveの操作をキャンセルしました。");
    return auth.getAccessToken();
  }

  function assertToken(token: string) {
    if (currentToken() !== token) throw new Error("Googleアカウントが変更されました。接続確認をやり直してください。");
  }

  function accountToken(accountId: string) {
    const token = currentToken();
    if (!verified || verified.token !== token || verified.accountId !== accountId) {
      throw new Error("Googleアカウントの接続確認をやり直してください。");
    }
    return token;
  }

  async function request(path: "about" | "files", parameters: Record<string, string>, token: string, body?: unknown): Promise<unknown> {
    assertToken(token);
    const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const controller = new AbortController();
    pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await requestFetch(url.toString(), {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      });
      assertToken(token);
      if (controller.signal.aborted) throw new Error("request-aborted");
      if (response.status === 401) {
        auth.invalidateAccessToken(token);
        verified = null;
        throw new Error("Googleへ再接続してから操作してください。");
      }
      if (!response.ok) throw new Error(response.status === 403
        ? "Google Driveにアクセスできません。Drive APIの設定とアクセス権を確認してください。"
        : "Google Driveの操作に失敗しました。通信状態を確認して再試行してください。");
      let value: unknown;
      try { value = await response.json(); } catch { throw new Error(INVALID_RESPONSE); }
      assertToken(token);
      if (controller.signal.aborted) throw new Error("request-aborted");
      return value;
    } catch (error) {
      // サーバーの本文やfetchの例外は認証情報を含む可能性があるため、そのまま転送しない。
      assertToken(token);
      if (error instanceof Error && [INVALID_RESPONSE,
        "Googleへ再接続してから操作してください。",
        "Google Driveにアクセスできません。Drive APIの設定とアクセス権を確認してください。",
        "Google Driveの操作に失敗しました。通信状態を確認して再試行してください。"].includes(error.message)) throw new Error(error.message);
      throw new Error(body === undefined
        ? "Google Driveへ接続できませんでした。通信状態を確認して再試行してください。"
        : "フォルダ作成の結果を確認できませんでした。接続確認からフォルダを再検索してください。");
    } finally {
      clearTimeout(timeout);
      pending.delete(controller);
    }
  }

  async function getAccount(): Promise<GoogleDriveAccount> {
    verified = null;
    const token = currentToken();
    const value = object(await request("about", { fields: "user(permissionId,displayName,emailAddress,me)" }, token));
    const user = object(value.user);
    if (user.me !== true) throw new Error(INVALID_RESPONSE);
    const account = { id: text(user.permissionId, 256), displayName: text(user.displayName, 256), emailAddress: text(user.emailAddress, 320) };
    verified = { token, accountId: account.id };
    return account;
  }

  async function findRoot(accountId: string): Promise<GoogleDriveRoot | null> {
    const token = accountToken(accountId);
    const value = object(await request("files", {
      q: ROOT_QUERY, spaces: "drive", corpora: "user", pageSize: "2",
      fields: `files(${ROOT_FIELDS}),nextPageToken,incompleteSearch`,
    }, token));
    if (value.incompleteSearch === true) throw new Error("専用フォルダを検索しきれませんでした。接続確認をやり直してください。");
    if (!Array.isArray(value.files)) throw new Error(INVALID_RESPONSE);
    if (value.nextPageToken || value.files.length > 1) {
      throw new Error("Overlay専用フォルダが複数あります。自動選択せず停止しました。");
    }
    return value.files.length ? root(value.files[0]) : null;
  }

  async function createRoot(accountId: string): Promise<GoogleDriveRoot> {
    if (creating) throw new Error("専用フォルダを作成中です。");
    const token = accountToken(accountId);
    creating = true;
    try {
      const existing = await findRoot(accountId);
      assertToken(token);
      if (existing) return existing;
      root(await request("files", { fields: ROOT_FIELDS }, token, {
        name: "Overlay", mimeType: FOLDER_TYPE, parents: ["root"], appProperties: ROOT_PROPERTIES,
      }));
      // 別タブなどとの同時作成も確認する。複数見つかっても削除や統合はしない。
      const created = await findRoot(accountId);
      if (!created) throw new Error("作成した専用フォルダを確認できませんでした。接続確認をやり直してください。");
      return created;
    } finally { creating = false; }
  }

  function dispose() {
    disposed = true;
    verified = null;
    for (const controller of pending) controller.abort();
    pending.clear();
  }

  return { getAccount, findRoot, createRoot, dispose };
}
