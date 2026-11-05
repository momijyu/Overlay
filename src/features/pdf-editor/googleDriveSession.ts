import { createGoogleDriveAuth } from "./googleDriveAuth";
import { createGoogleDriveClient, type GoogleDriveAccount, type GoogleDriveRoot } from "./googleDriveClient";

// 同じページ内だけで再利用する。SDK・認証はgetSessionを呼んだだけでは開始せず、DB等へトークンを書かない。
export function createGoogleDriveSession() {
  const auth = createGoogleDriveAuth();
  const drive = createGoogleDriveClient(auth);
  let connection: { account: GoogleDriveAccount; root: GoogleDriveRoot | null; token: string } | null = null;
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
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
    dispose() { connection = null; drive.dispose(); auth.disconnect(); },
  };
}

let sharedSession: ReturnType<typeof createGoogleDriveSession> | null = null;
export function getGoogleDriveSession() { return sharedSession ??= createGoogleDriveSession(); }
