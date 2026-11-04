// 今回使うGIS token modelのAPIだけを定義する。SDKは明示的な準備操作まで読み込まない。
export type GoogleTokenClientConfig = {
  client_id: string;
  scope: string;
  include_granted_scopes: boolean;
  prompt: "select_account";
  callback: (response: unknown) => void;
  error_callback: (error: { type?: string }) => void;
};

export type GoogleOAuth2 = {
  initTokenClient(config: GoogleTokenClientConfig): { requestAccessToken(): void };
};

const SCRIPT_URL = "https://accounts.google.com/gsi/client";
const SCRIPT_ID = "overlay-google-identity";
let loading: Promise<GoogleOAuth2> | null = null;

function availableIdentity(): GoogleOAuth2 | undefined {
  const api = (window as Window & { google?: { accounts?: { oauth2?: GoogleOAuth2 } } }).google?.accounts?.oauth2;
  return typeof api?.initTokenClient === "function" ? api : undefined;
}

export function loadGoogleIdentity(): Promise<GoogleOAuth2> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Googleとの接続はブラウザで操作してください。"));
  }
  if (!window.isSecureContext) {
    return Promise.reject(new Error("Googleとの接続にはHTTPSまたはlocalhostを使用してください。"));
  }
  const available = availableIdentity();
  if (available) return Promise.resolve(available);
  if (loading) return loading;

  loading = new Promise<GoogleOAuth2>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing && (!(existing instanceof HTMLScriptElement) || existing.src !== SCRIPT_URL)) {
      reject(new Error("Googleの接続準備に失敗しました。画面を再読み込みしてください。"));
      return;
    }
    const script = existing as HTMLScriptElement | null ?? document.createElement("script");
    const cleanup = () => {
      clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const fail = () => {
      cleanup();
      // 他の処理が所有するscriptは削除しない。
      if (!existing) script.remove();
      reject(new Error("Googleの接続準備に失敗しました。通信状態を確認して再試行してください。"));
    };
    const onLoad = () => {
      const api = availableIdentity();
      if (!api) { fail(); return; }
      cleanup();
      resolve(api);
    };
    const onError = () => fail();
    const timeout = setTimeout(fail, 15_000);
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    if (!existing) {
      try {
        script.id = SCRIPT_ID;
        script.src = SCRIPT_URL;
        script.async = true;
        script.referrerPolicy = "strict-origin-when-cross-origin";
        document.head.append(script);
      } catch { fail(); }
    }
  }).finally(() => {
    loading = null;
  });
  return loading;
}
