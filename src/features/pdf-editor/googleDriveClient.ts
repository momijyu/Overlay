import type { NoteBackup } from "./noteBackupData";
import type { DriveNoteAccess } from "./googleDriveNotes";
import type { DriveOverwriteTarget } from "./googleDriveNoteData";
import { DriveHttpError } from "./driveHttpError";
import { speedMeasurements } from "./speedMeasurements";

// 通常の自動保存とは分離し、確認後の手動保存・コピー読み込みを扱う。
type DriveAuthorization = { getAccessToken: () => string; invalidateAccessToken: (token: string) => void;
  subscribe?: (listener: () => void) => () => void };
export type GoogleDriveAccount = { id: string; displayName: string; emailAddress: string };
export type GoogleDriveRoot = { id: string; name: string };
const FOLDER_TYPE = "application/vnd.google-apps.folder";
const ROOT_PROPERTIES = { overlayApp: "overlay", overlayRole: "root", overlaySchema: "1" };
const ROOT_FIELDS = "id,name,mimeType,appProperties,ownedByMe,trashed";
const ROOT_QUERY = "trashed = false and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and 'me' in owners"
  + " and appProperties has { key='overlayApp' and value='overlay' }"
  + " and appProperties has { key='overlayRole' and value='root' }";
const INVALID_RESPONSE = "Google Driveの応答を確認できませんでした。接続確認をやり直してください。";
// multipartのメタデータ分も含め、Googleの小さいファイル向け5MBの目安を下回る範囲。
const SINGLE_JSON_UPLOAD_BYTES = 4 * 1024 * 1024;
const CHECK_TTL_MS = 30_000;
type ConnectionChecks = {
  token?: string; revision: number;
  account?: { value: GoogleDriveAccount; at: number };
  root?: { accountId: string; value: GoogleDriveRoot; at: number };
};
// 同じ認可オブジェクトの完了済み結果だけをメモリで共有する。通信・AbortControllerは共有しない。
const connectionChecks = new WeakMap<DriveAuthorization, ConnectionChecks>();

async function boundedBlob(response: Response, maximumBytes: number): Promise<Blob> {
  const length = response.headers.get("Content-Length");
  if (length && Number(length) > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Driveファイルが読み込み上限を超えています。");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Driveファイルを読み取れませんでした。");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) throw new Error("Driveファイルが読み込み上限を超えています。");
      chunks.push(new Uint8Array(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return new Blob(chunks);
}

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
  let checks = connectionChecks.get(auth);
  if (!checks) { checks = { revision: 0 }; connectionChecks.set(auth, checks); }
  const shared = checks;
  function clearChecks() { shared.revision++; shared.account = undefined; shared.root = undefined; }
  const unsubscribe = auth.subscribe?.(() => { clearChecks(); shared.token = undefined; });
  let verified: { token: string; accountId: string } | null = null;
  let disposed = false;
  let creating = false;
  let savingNote = false;
  let cancellationVersion = 0;
  let rootLookup: { token: string; accountId: string; result: Promise<GoogleDriveRoot | null> } | null = null;
  const pending = new Set<AbortController>();

  function currentToken() {
    if (disposed) throw new Error("Google Driveの操作をキャンセルしました。");
    let token: string;
    try { token = auth.getAccessToken(); }
    catch (error) { clearChecks(); shared.token = undefined; throw error; }
    if (shared.token !== token) { clearChecks(); shared.token = token; }
    return token;
  }

  function assertToken(token: string) {
    if (currentToken() !== token) throw new Error("Googleアカウントが変更されました。接続確認をやり直してください。");
  }

  function assertOperation(version: number) {
    if (version !== cancellationVersion || disposed) throw new Error("Google Driveの操作をキャンセルしました。");
  }

  function accountToken(accountId: string) {
    const token = currentToken();
    if (!verified || verified.token !== token || verified.accountId !== accountId) {
      throw new Error("Googleアカウントの接続確認をやり直してください。");
    }
    return token;
  }

  async function request(path: string, parameters: Record<string, string>, token: string, body?: unknown, options: {
    upload?: boolean; url?: string; method?: "POST" | "PUT" | "PATCH"; rawBody?: Blob; headers?: Record<string, string>;
    read?: (response: Response) => Promise<unknown>;
    operationVersion?: number;
  } = {}): Promise<unknown> {
    const operationVersion = options.operationVersion ?? cancellationVersion;
    assertOperation(operationVersion);
    assertToken(token);
    if (!/^(about|files(?:\/[A-Za-z0-9_-]+)?)$/.test(path)) throw new Error(INVALID_RESPONSE);
    const url = new URL(options.url ?? `https://www.googleapis.com/${options.upload ? "upload/" : ""}drive/v3/${path}`);
    if (url.origin !== "https://www.googleapis.com" || url.username || url.password || url.hash
      || (options.url && url.pathname !== `/upload/drive/v3/${path}`)) throw new Error(INVALID_RESPONSE);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    const controller = new AbortController();
    pending.add(controller);
    const timeout = setTimeout(() => controller.abort(), options.rawBody ? 120_000 : 30_000);
    const timing = speedMeasurements.begin("drive.http", { method: options.method ?? (body === undefined ? "GET" : "POST"),
      requestKind: options.upload || options.url ? "upload" : path === "about" ? "account"
        : parameters.alt === "media" ? "download" : path === "files" ? "list" : "metadata" });
    let headersMs = 0, httpStatus = 0;
    try {
      const response = await requestFetch(url.toString(), {
        method: options.method ?? (body === undefined ? "GET" : "POST"),
        headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...options.headers, Authorization: `Bearer ${token}` },
        ...(options.rawBody ? { body: options.rawBody } : body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      });
      headersMs = timing.elapsedMs(); httpStatus = response.status;
      assertToken(token);
      assertOperation(operationVersion);
      if (controller.signal.aborted) throw new Error("request-aborted");
      if (response.status === 401) {
        auth.invalidateAccessToken(token);
        clearChecks();
        verified = null;
        throw new Error("Googleへ再接続してから操作してください。");
      }
      if (!response.ok) throw new DriveHttpError(response.status, response.status === 403
        ? "Google Driveにアクセスできません。Drive APIの設定とアクセス権を確認してください。"
        : response.status === 404 ? "Driveの対象ファイルが見つからないか、アクセスできません。一覧を更新してください。"
        : "Google Driveの操作に失敗しました。通信状態を確認して再試行してください。");
      let value: unknown;
      try { value = options.read ? await options.read(response) : await response.json(); }
      catch { controller.abort(); throw new Error(INVALID_RESPONSE); }
      assertToken(token);
      assertOperation(operationVersion);
      if (controller.signal.aborted) throw new Error("request-aborted");
      timing.finish("ok", { headersMs, bodyMs: Math.max(0, timing.elapsedMs() - headersMs), httpStatus });
      return value;
    } catch (error) {
      // 応答前の接続失敗を「本文の受信時間」として記録しない。
      if (httpStatus === 0) headersMs = timing.elapsedMs();
      timing.finish("error", { headersMs, bodyMs: httpStatus === 0 ? 0 : Math.max(0, timing.elapsedMs() - headersMs), httpStatus });
      // サーバーの本文やfetchの例外は認証情報を含む可能性があるため、そのまま転送しない。
      assertToken(token);
      assertOperation(operationVersion);
      if (error instanceof DriveHttpError) throw error;
      if (error instanceof Error && [INVALID_RESPONSE,
        "Googleへ再接続してから操作してください。",
        "Google Driveにアクセスできません。Drive APIの設定とアクセス権を確認してください。",
        "Driveの対象ファイルが見つからないか、アクセスできません。一覧を更新してください。",
        "Google Driveの操作に失敗しました。通信状態を確認して再試行してください。"].includes(error.message)) throw new Error(error.message);
      throw new DriveHttpError(0, options.rawBody ? "Driveへの送信結果を確認できませんでした。一覧を更新して確認してください。"
        : body === undefined
        ? "Google Driveへ接続できませんでした。通信状態を確認して再試行してください。"
        : "フォルダ作成の結果を確認できませんでした。接続確認からフォルダを再検索してください。");
    } finally {
      timing.finish("cancelled");
      clearTimeout(timeout);
      pending.delete(controller);
    }
  }

  async function getAccount(options: { reuseConfirmed?: boolean } = {}): Promise<GoogleDriveAccount> {
    const operationVersion = cancellationVersion;
    const token = currentToken();
    const cached = shared.account;
    if (options.reuseConfirmed && cached && Date.now() >= cached.at && Date.now() - cached.at < CHECK_TTL_MS) {
      speedMeasurements.begin("drive.connection", { connectionCheck: "account-hit" }).finish();
      verified = { token, accountId: cached.value.id };
      return { ...cached.value };
    }
    speedMeasurements.begin("drive.connection", { connectionCheck: !options.reuseConfirmed ? "account-explicit"
      : cached ? "account-expired" : "account-missing" }).finish();
    // 通常のgetAccountは明示的な接続確認。短期キャッシュがあってもAPIで再確認する。
    verified = null; clearChecks();
    const revision = shared.revision;
    const value = object(await request("about", { fields: "user(permissionId,displayName,emailAddress,me)" }, token));
    const user = object(value.user);
    if (user.me !== true) throw new Error(INVALID_RESPONSE);
    const account = { id: text(user.permissionId, 256), displayName: text(user.displayName, 256), emailAddress: text(user.emailAddress, 320) };
    assertToken(token); assertOperation(operationVersion);
    verified = { token, accountId: account.id };
    if (shared.revision === revision) shared.account = { value: { ...account }, at: Date.now() };
    return account;
  }

  async function findRoot(accountId: string): Promise<GoogleDriveRoot | null> {
    return lookupRoot(accountId, "root-explicit");
  }

  async function lookupRoot(accountId: string, reason: import("./speedMeasurements").ConnectionCheck): Promise<GoogleDriveRoot | null> {
    const token = accountToken(accountId);
    if (rootLookup?.token === token && rootLookup.accountId === accountId) return rootLookup.result;
    speedMeasurements.begin("drive.connection", { connectionCheck: reason }).finish();
    // findRootの明示呼び出しは必ず再検索する。失敗・未検出時に古い共有結果へ戻らない。
    shared.root = undefined;
    const revision = ++shared.revision;
    const result = (async () => {
    const value = object(await request("files", {
      q: ROOT_QUERY, spaces: "drive", corpora: "user", pageSize: "2",
      fields: `files(${ROOT_FIELDS}),nextPageToken,incompleteSearch`,
    }, token));
    if (value.incompleteSearch === true) throw new Error("専用フォルダを検索しきれませんでした。接続確認をやり直してください。");
    if (!Array.isArray(value.files)) throw new Error(INVALID_RESPONSE);
    if (value.nextPageToken || value.files.length > 1) {
      throw new Error("Overlay専用フォルダが複数あります。使用していたフォルダをマイドライブ直下に1つ残し、それ以外は別の場所へ移動してから再接続してください。フォルダやデータの削除・統合は不要です。");
    }
    return value.files.length ? root(value.files[0]) : null;
    })();
    const lookup = { token, accountId, result };
    rootLookup = lookup;
    try {
      const value = await result;
      assertToken(token);
      if (shared.revision === revision) shared.root = value ? { accountId, value: { ...value }, at: Date.now() } : undefined;
      return value;
    } catch (error) { if (shared.revision === revision) shared.root = undefined; throw error; }
    finally { if (rootLookup === lookup) rootLookup = null; }
  }

  async function createRoot(accountId: string): Promise<GoogleDriveRoot> {
    if (creating) throw new Error("専用フォルダを作成中です。");
    const token = accountToken(accountId);
    const operationVersion = cancellationVersion;
    creating = true;
    try {
      const existing = await findRoot(accountId);
      assertToken(token);
      assertOperation(operationVersion);
      if (existing) return existing;
      root(await request("files", { fields: ROOT_FIELDS }, token, {
        name: "Overlay", mimeType: FOLDER_TYPE, parents: ["root"], appProperties: ROOT_PROPERTIES,
      }, { operationVersion }));
      assertOperation(operationVersion);
      // 別タブなどとの同時作成も確認する。複数見つかっても削除や統合はしない。
      const created = await findRoot(accountId);
      if (!created) throw new Error("作成した専用フォルダを確認できませんでした。接続確認をやり直してください。");
      return created;
    } finally { creating = false; }
  }

  async function noteAccess(accountId: string, rootId: string): Promise<DriveNoteAccess> {
    const operationVersion = cancellationVersion;
    const token = accountToken(accountId);
    const cached = shared.root;
    const reuseRoot = cached?.accountId === accountId && cached.value.id === rootId
      && Date.now() >= cached.at && Date.now() - cached.at < CHECK_TTL_MS
      ? cached.value : undefined;
    if (reuseRoot) speedMeasurements.begin("drive.connection", { connectionCheck: "root-hit" }).finish();
    const currentRoot = reuseRoot ?? await lookupRoot(accountId, !cached ? "root-missing"
      : cached.accountId !== accountId || cached.value.id !== rootId ? "root-mismatch" : "root-expired");
    assertToken(token);
    assertOperation(operationVersion);
    if (!currentRoot || currentRoot.id !== rootId) throw new Error("専用フォルダが変更されました。接続確認をやり直してください。");
    const noteRequest: typeof request = (path, parameters, token, body, options) => {
      assertOperation(operationVersion);
      return request(path, parameters, token, body, { ...options, operationVersion });
    };
    async function upload(metadata: Record<string, unknown>, data: Blob, fileId?: string) {
        const { DRIVE_NOTE_FIELDS } = await import("./googleDriveNoteData");
        const path = fileId ? `files/${fileId}` : "files";
        if (fileId && !metadata.name && metadata.mimeType === "application/json" && data.size <= SINGLE_JSON_UPLOAD_BYTES) {
          return noteRequest(path, { uploadType: "media", fields: DRIVE_NOTE_FIELDS }, token, undefined, {
            upload: true, method: "PATCH", rawBody: data, headers: { "Content-Type": "application/json" },
          });
        }
        // 小さい編集JSONだけはメタデータと本文を1回で送る。元PDF・大きいJSONは従来の方式を維持する。
        // 手動保存の応答不明は一覧で確認する。自動保存だけは予約IDで結果を再検証する。
        if (metadata.mimeType === "application/json" && data.size <= SINGLE_JSON_UPLOAD_BYTES) {
          const boundary = `overlay_${crypto.randomUUID()}`;
          const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
            JSON.stringify(metadata), `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
            data, `\r\n--${boundary}--\r\n`]);
          return noteRequest(path, { uploadType: "multipart", fields: DRIVE_NOTE_FIELDS }, token, undefined, {
            upload: true, method: fileId ? "PATCH" : "POST", rawBody: body, headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
          });
        }
        const location = await noteRequest(path, { uploadType: "resumable", fields: DRIVE_NOTE_FIELDS }, token, metadata, {
          upload: true, ...(fileId ? { method: "PATCH" as const } : {}),
          headers: { "X-Upload-Content-Type": String(metadata.mimeType), "X-Upload-Content-Length": String(data.size) },
          read: async (response) => {
            const value = response.headers.get("Location");
            if (!value) throw new Error(INVALID_RESPONSE);
            const url = new URL(value);
            if (url.origin !== "https://www.googleapis.com" || url.pathname !== `/upload/drive/v3/${path}`
              || url.username || url.password || url.hash || !url.searchParams.get("upload_id")) throw new Error(INVALID_RESPONSE);
            return url.toString();
          },
        });
        return noteRequest(path, {}, token, undefined, { url: location as string, method: "PUT", rawBody: data,
          headers: { "Content-Type": String(metadata.mimeType) } });
    }
    return {
      json: (path, parameters, body) => noteRequest(path, parameters, token, body),
      download: async (fileId, maximumBytes) => await noteRequest(`files/${fileId}`, { alt: "media" }, token, undefined,
        { read: (response) => boundedBlob(response, maximumBytes) }) as Blob,
      upload,
      updateMetadata: (fileId, metadata, parameters = {}) => noteRequest(`files/${fileId}`, { ...parameters, fields: "id,name,mimeType,ownedByMe,trashed,parents,appProperties,size,modifiedTime,version,sha256Checksum" }, token, metadata, { method: "PATCH" }),
      replace: (fileId, data, metadata) => upload({ ...metadata, mimeType: "application/json" }, data, fileId),
    };
  }

  async function findSaveTarget(accountId: string, rootId: string, backup: NoteBackup) {
    const operationVersion = cancellationVersion;
    const { singleDriveNote } = await import("./googleDriveNoteData");
    assertOperation(operationVersion);
    const note = singleDriveNote(backup);
    const access = await noteAccess(accountId, rootId);
    const { findDriveOverwriteTarget } = await import("./googleDriveNotes");
    return findDriveOverwriteTarget(access, rootId, note.title);
  }

  async function findSaveTargetByTitle(accountId: string, rootId: string, title: string) {
    if (!title.trim() || [...title].length > 120 || /\p{Cc}/u.test(title)) throw new Error("保存するノート名が不正です。");
    const access = await noteAccess(accountId, rootId);
    const { findDriveOverwriteTarget } = await import("./googleDriveNotes");
    return findDriveOverwriteTarget(access, rootId, title);
  }

  async function saveConfirmedNote(accountId: string, rootId: string, backup: NoteBackup, target: DriveOverwriteTarget | null) {
    if (savingNote) throw new Error("Driveへノートを保存中です。");
    savingNote = true;
    try {
      const access = await noteAccess(accountId, rootId);
      const { overwriteDriveNote, findDriveOverwriteTarget, saveNewDriveNote } = await import("./googleDriveNotes");
      if (target) return await overwriteDriveNote(access, rootId, backup, target);
      const { singleDriveNote } = await import("./googleDriveNoteData");
      if (await findDriveOverwriteTarget(access, rootId, singleDriveNote(backup).title)) {
        throw new Error("同名ノートが追加されています。キャンセルして保存対象を選び直してください。");
      }
      return await saveNewDriveNote(access, rootId, backup);
    } finally { savingNote = false; }
  }

  async function saveNewNote(accountId: string, rootId: string, backup: NoteBackup) {
    if (savingNote) throw new Error("Driveへノートを保存中です。");
    savingNote = true;
    try {
      const access = await noteAccess(accountId, rootId);
      const { saveNewDriveNote } = await import("./googleDriveNotes");
      return await saveNewDriveNote(access, rootId, backup);
    } finally { savingNote = false; }
  }

  async function listNotes(accountId: string, rootId: string, pageToken?: string) {
    const access = await noteAccess(accountId, rootId);
    const { listDriveNotes } = await import("./googleDriveNotes");
    return listDriveNotes(access, rootId, pageToken);
  }

  async function loadNote(accountId: string, rootId: string, noteId: string) {
    const access = await noteAccess(accountId, rootId);
    const { loadDriveNote } = await import("./googleDriveNotes");
    return loadDriveNote(access, rootId, noteId);
  }

  function cancelPending() {
    cancellationVersion++;
    rootLookup = null; clearChecks();
    for (const controller of pending) controller.abort();
    pending.clear();
  }

  function dispose() {
    disposed = true;
    verified = null;
    cancelPending();
    unsubscribe?.();
  }

  return { getAccount, findRoot, createRoot, saveNewNote, findSaveTarget, findSaveTargetByTitle, saveConfirmedNote, listNotes, loadNote,
    // 自動保存は別インスタンスで利用し、手動モーダルを閉じる中断と分離する。
    autosaveAccess: noteAccess, cancelPending, dispose };
}
