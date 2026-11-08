import { createGoogleDriveAuth } from "./googleDriveAuth";
import { createGoogleDriveClient, type GoogleDriveAccount, type GoogleDriveRoot } from "./googleDriveClient";

// 同じページ内だけで再利用する。SDK・認証はgetSessionを呼んだだけでは開始せず、DB等へトークンを書かない。
export function createGoogleDriveSession() {
  const auth = createGoogleDriveAuth();
  const drive = createGoogleDriveClient(auth);
  let connection: { account: GoogleDriveAccount; root: GoogleDriveRoot | null; token: string } | null = null;
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
  const unsubscribeAuth = auth.subscribe(() => {
    if (auth.getState().status !== "authorized") connection = null;
    changed();
  });
  return {
    auth, drive,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getConnection() {
      if (auth.getState().status !== "authorized") { connection = null; return null; }
      if (!connection || connection.token !== auth.getAccessToken()) { connection = null; return null; }
      return { account: connection.account, root: connection.root };
    },
    remember(account: GoogleDriveAccount, root: GoogleDriveRoot | null) {
      connection = { account, root, token: auth.getAccessToken() };
      changed();
    },
    clear() { connection = null; changed(); },
    detach() {
      drive.cancelPending();
      // 認可・準備の途中は中断する。有効な接続だけ画面を閉じた後もメモリへ保持する。
      if (auth.getState().status !== "authorized") { connection = null; auth.disconnect(); }
    },
    dispose() { connection = null; drive.dispose(); auth.disconnect(); unsubscribeAuth(); listeners.clear(); },
  };
}

let sharedSession: ReturnType<typeof createGoogleDriveSession> | null = null;
const SESSION_KEY = Symbol.for("overlay.google-drive-session.v1");
type SessionWindow = Window & { [SESSION_KEY]?: { clientId: string; session: ReturnType<typeof createGoogleDriveSession> } };
export function getGoogleDriveSession() {
  if (typeof window === "undefined") return sharedSession ??= createGoogleDriveSession();
  // Fast Refreshでモジュールだけが再評価されても、既存runnerと新しい画面を同じ接続へ結び付ける。
  // このページのメモリ内だけ。ページ再読み込み・別タブには持ち越さず、永続保存もしない。
  const owner = window as SessionWindow;
  const clientId = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "").trim();
  const current = owner[SESSION_KEY];
  if (current?.clientId === clientId) return current.session;
  current?.session.dispose();
  const session = createGoogleDriveSession();
  Object.defineProperty(owner, SESSION_KEY, { configurable: true, value: { clientId, session } });
  return session;
}
