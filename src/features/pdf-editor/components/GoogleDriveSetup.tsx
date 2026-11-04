"use client";

import { useEffect, useRef, useState } from "react";
import { createGoogleDriveAuth } from "../googleDriveAuth";
import { createGoogleDriveClient, type GoogleDriveAccount, type GoogleDriveRoot } from "../googleDriveClient";

type Stage = "preparing" | "ready" | "checking" | "creating" | "checked" | "error";
type SetupState = { stage: Stage; account: GoogleDriveAccount | null; root: GoogleDriveRoot | null; error: string | null };
type Runtime = { auth: ReturnType<typeof createGoogleDriveAuth>; drive: ReturnType<typeof createGoogleDriveClient>; busy: boolean };

export function GoogleDriveSetup({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return <div className="border-t border-base-300 p-4">
    <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setOpen(true)}>Google Driveの接続確認</button>
    {open && <GoogleDriveSetupDialog onClose={() => setOpen(false)} />}
  </div>;
}

export function GoogleDriveSetupDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const [state, setState] = useState<SetupState>({ stage: "preparing", account: null, root: null, error: null });

  function prepare(runtime: Runtime) {
    runtime.busy = true;
    return runtime.auth.prepare().then(() => {
      if (runtimeRef.current === runtime) setState({ stage: "ready", account: null, root: null, error: null });
    }).catch((error: Error) => {
      if (runtimeRef.current === runtime) setState({ stage: "error", account: null, root: null, error: error.message });
    }).finally(() => { runtime.busy = false; });
  }

  useEffect(() => {
    const auth = createGoogleDriveAuth();
    const runtime = { auth, drive: createGoogleDriveClient(auth), busy: false };
    runtimeRef.current = runtime;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    void prepare(runtime);
    return () => {
      runtimeRef.current = null;
      runtime.drive.dispose();
      runtime.auth.disconnect();
      if (dialog?.open) dialog.close();
    };
  }, []);

  async function checkConnection() {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.busy) return;
    runtime.busy = true;
    setState({ stage: "checking", account: null, root: null, error: null });
    try {
      // SDK準備は完了済み。このクリック内で、awaitより前に認証ポップアップを要求する。
      await runtime.auth.connect();
      if (runtimeRef.current !== runtime) return;
      const account = await runtime.drive.getAccount();
      if (runtimeRef.current !== runtime) return;
      const root = await runtime.drive.findRoot(account.id);
      if (runtimeRef.current === runtime) setState({ stage: "checked", account, root, error: null });
    } catch (error) {
      if (runtimeRef.current === runtime) setState({ stage: "error", account: null, root: null,
        error: error instanceof Error ? error.message : "接続確認に失敗しました。" });
    } finally { runtime.busy = false; }
  }

  async function createFolder() {
    const runtime = runtimeRef.current;
    const account = state.account;
    if (!runtime || runtime.busy || !account || state.stage !== "checked") return;
    runtime.busy = true;
    setState({ ...state, stage: "creating", error: null });
    try {
      const root = await runtime.drive.createRoot(account.id);
      if (runtimeRef.current === runtime) setState({ stage: "checked", account, root, error: null });
    } catch (error) {
      if (runtimeRef.current === runtime) setState({ stage: "error", account: null, root: null,
        error: error instanceof Error ? error.message : "専用フォルダを作成できませんでした。" });
    } finally { runtime.busy = false; }
  }

  const busy = state.stage === "preparing" || state.stage === "checking" || state.stage === "creating";
  return <dialog ref={dialogRef} className="modal" aria-labelledby="google-drive-setup-title"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onClose={(event) => {
      // Strict Modeのeffect再実行で、一度閉じた後に再表示したdialogを古いcloseイベントで閉じない。
      if (event.target === event.currentTarget && !event.currentTarget.open) onClose();
    }}>
    <div className="modal-box max-w-md rounded-box space-y-4">
      <h2 id="google-drive-setup-title" className="text-lg font-bold">Google Driveの接続確認</h2>
      <p className="text-sm">ノートのDrive保存はまだ利用できません。保存先はこのブラウザのままです。</p>
      {state.account && <dl className="space-y-1 text-sm break-words">
        <dt className="font-semibold">確認したアカウント</dt>
        <dd>{state.account.displayName}</dd><dd>{state.account.emailAddress}</dd>
      </dl>}
      {state.stage === "checked" && <p role="status" className="text-sm break-words">
        {state.root ? `専用フォルダ「${state.root.name}」を確認しました。` : "専用フォルダは未作成です。"}
      </p>}
      {busy && <p role="status" className="text-sm">{state.stage === "preparing" ? "接続準備中…"
        : state.stage === "checking" ? "接続確認中…" : "専用フォルダを作成中…"}</p>}
      {state.error && <p role="alert" className="text-sm text-error">{state.error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-sm" onClick={onClose}>閉じる</button>
        {state.stage === "error" && <button type="button" className="btn btn-sm" onClick={() => {
          const runtime = runtimeRef.current;
          if (!runtime || runtime.busy) return;
          setState({ stage: "preparing", account: null, root: null, error: null });
          void prepare(runtime);
        }}>接続準備をやり直す</button>}
        {!busy && state.stage !== "error" && <button type="button" className="btn btn-sm"
          onClick={() => { void checkConnection(); }}>{state.account ? "アカウントを選び直す" : "Googleで接続確認"}</button>}
        {state.stage === "checked" && !state.root && <button type="button" className="btn btn-sm btn-primary"
          onClick={() => { void createFolder(); }}>専用フォルダを作成</button>}
      </div>
    </div>
    <div className="modal-backdrop"><button type="button" tabIndex={-1} aria-label="接続確認を閉じる" onClick={onClose} /></div>
  </dialog>;
}
