import { loadGoogleIdentity, type GoogleOAuth2 } from "./googleIdentity";

export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH_TIMEOUT_MS = 120_000;
type AuthStatus = "unconfigured" | "unprepared" | "preparing" | "disconnected" | "authorizing" | "authorized" | "reconnect-required" | "error";
export type GoogleDriveAuthState = { status: AuthStatus; expiresAt: number | null; error: string | null };
type Session = { token: string; expiresAt: number };

// 保存先の切り替えとは分離する。「authorized」はGoogle APIの認可だけを表し、Drive保存済みではない。
// トークンはこのインスタンスのメモリだけに保持し、公開状態・DB・ログ・URLへ渡さない。
export function createGoogleDriveAuth(options: {
  clientId?: string;
  loadIdentity?: () => Promise<GoogleOAuth2>;
  now?: () => number;
} = {}) {
  const clientId = (options.clientId ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "").trim();
  const now = options.now ?? Date.now;
  const loadIdentity = options.loadIdentity ?? loadGoogleIdentity;
  let status: AuthStatus = clientId ? "unprepared" : "unconfigured";
  let error: string | null = null;
  let session: Session | null = null;
  let identity: GoogleOAuth2 | null = null;
  let generation = 0;
  let preparation: Promise<void> | null = null;
  let active: { cancel: () => void } | null = null;

  function setState(next: AuthStatus, message: string | null = null) {
    status = next;
    error = message;
  }

  function getState(): GoogleDriveAuthState {
    if (session && now() >= session.expiresAt) {
      session = null;
      setState("reconnect-required", "Googleとの接続期限が切れました。再接続してください。");
    }
    return { status, expiresAt: session?.expiresAt ?? null, error };
  }

  function prepare(): Promise<void> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.apps\.googleusercontent\.com$/.test(clientId)) {
      setState("unconfigured", "GoogleのOAuthクライアントIDを設定してください。");
      return Promise.reject(new Error(error!));
    }
    if (identity) return Promise.resolve();
    if (preparation) return preparation;
    const current = generation;
    setState("preparing");
    const attempt = Promise.resolve().then(() => loadIdentity()).then((api) => {
      if (current !== generation) throw new Error("Googleとの接続準備をキャンセルしました。");
      identity = api;
      setState("disconnected");
    }).catch(() => {
      const message = current === generation
        ? "Googleの接続準備に失敗しました。通信状態とブラウザの設定を確認して再試行してください。"
        : "Googleとの接続準備をキャンセルしました。";
      if (current === generation) setState("error", message);
      // SDKが返した詳細に認証情報が含まれても、エラーやcauseへ複製しない。
      throw new Error(message);
    }).finally(() => { if (preparation === attempt) preparation = null; });
    preparation = attempt;
    return attempt;
  }

  // prepare完了後のクリックから直接呼ぶ。SDK読み込みをawaitした後にポップアップを開かない。
  function connect(): Promise<void> {
    if (active) return Promise.reject(new Error("Googleとの接続操作中です。完了またはキャンセルを待ってください。"));
    if (!identity) return Promise.reject(new Error("先にGoogleの接続準備を完了してください。"));
    const api = identity;
    const current = ++generation;
    session = null;
    setState("authorizing");
    return new Promise<void>((resolve, reject) => {
      const finish = (message: string | null, nextSession?: Session) => {
        if (current !== generation || active !== attempt) return;
        clearTimeout(timeout);
        active = null;
        if (message) {
          session = null;
          setState("error", message);
          reject(new Error(message));
        } else {
          session = nextSession!;
          setState("authorized");
          resolve();
        }
      };
      const attempt = { cancel: () => finish("Googleとの接続をキャンセルしました。") };
      const timeout = setTimeout(() => finish("Googleとの接続が完了しませんでした。再試行してください。"), AUTH_TIMEOUT_MS);
      active = attempt;
      try {
        api.initTokenClient({
          client_id: clientId,
          scope: GOOGLE_DRIVE_SCOPE,
          include_granted_scopes: false,
          prompt: "select_account",
          callback: (response) => {
            if (current !== generation || active !== attempt) return;
            const value = response && typeof response === "object" ? response as Record<string, unknown> : {};
            if (value.error) {
              finish(value.error === "access_denied" ? "Googleとの接続が許可されませんでした。" : "Googleとの接続に失敗しました。再試行してください。");
              return;
            }
            const scopes = typeof value.scope === "string" ? value.scope.split(/\s+/) : [];
            if (!scopes.includes(GOOGLE_DRIVE_SCOPE)) { finish("Google Driveへのアクセスが許可されていません。再接続してください。"); return; }
            const seconds = typeof value.expires_in === "number" || typeof value.expires_in === "string" ? Number(value.expires_in) : NaN;
            const ttl = seconds * 1000;
            const expiresAt = now() + ttl - Math.min(30_000, ttl / 10);
            if (typeof value.access_token !== "string" || !/^[A-Za-z0-9._~+\/-]+=*$/.test(value.access_token)
              || typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer"
              || !Number.isFinite(ttl) || ttl <= 0 || !Number.isSafeInteger(expiresAt) || expiresAt <= now()) {
              finish("Googleの認証情報を確認できませんでした。再接続してください。");
              return;
            }
            finish(null, { token: value.access_token, expiresAt });
          },
          error_callback: (failure) => {
            const message = failure?.type === "popup_closed" ? "Googleとの接続画面が閉じられました。"
              : failure?.type === "popup_failed_to_open" ? "Googleの接続画面を開けません。ポップアップの設定を確認してください。"
                : "Googleとの接続に失敗しました。再試行してください。";
            finish(message);
          },
        }).requestAccessToken();
      } catch { finish("Googleとの接続を開始できませんでした。再試行してください。"); }
    });
  }

  function getAccessToken(): string {
    getState();
    if (!session) throw new Error("Googleへ再接続してから操作してください。");
    return session.token;
  }

  // 以前のリクエストの401で、新しく取得した認証情報を失効させない。
  function invalidateAccessToken(tokenUsed: string) {
    if (!session || session.token !== tokenUsed) return;
    session = null;
    setState("reconnect-required", "Googleとの接続を確認できません。再接続してください。");
  }

  function disconnect() {
    active?.cancel();
    generation++;
    preparation = null;
    session = null;
    setState(identity ? "disconnected" : clientId ? "unprepared" : "unconfigured");
    // ローカルの認可情報だけを破棄する。ノート削除やGoogle全権限のrevokeは行わない。
  }

  return { prepare, connect, getState, getAccessToken, invalidateAccessToken, disconnect };
}
