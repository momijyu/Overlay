"use client";

import { useEffect, useRef, useState } from "react";
import type { GoogleDriveAccount, GoogleDriveRoot } from "../googleDriveClient";
import { getGoogleDriveSession } from "../googleDriveSession";
import type { NoteBackup } from "../noteBackupData";
import type { DriveSaveSource } from "../googleDriveBatch";
import { GoogleDriveNotes } from "./GoogleDriveNotes";
import { GoogleDriveBackupRestore } from "./GoogleDriveBackupRestore";
import { SpeedMeasurementPanel } from "./SpeedMeasurementPanel";

type Stage = "preparing" | "ready" | "checking" | "creating" | "checked" | "error";
type SetupState = { stage: Stage; account: GoogleDriveAccount | null; root: GoogleDriveRoot | null; error: string | null };
type Runtime = ReturnType<typeof getGoogleDriveSession> & { busy: boolean };
export type DriveSaveRequest = { id: string; backup: NoteBackup } | { id: string; sources: DriveSaveSource[] };
type NoteActions = { captureNote?: () => NoteBackup;
  saveRequest?: DriveSaveRequest | null; onSaveRequestClose?: () => void };

export function GoogleDriveSetup({ disabled = false, captureNote, saveRequest, onSaveRequestClose }: { disabled?: boolean } & NoteActions) {
  const [open, setOpen] = useState(false);
  const [closedRequest, setClosedRequest] = useState<string | null>(null);
  const activeRequest = saveRequest && saveRequest.id !== closedRequest ? saveRequest : null;
  return <div className="border-t border-base-300 p-4">
    <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => setOpen(true)}>Google Drive</button>
    {(open || activeRequest) && <GoogleDriveSetupDialog captureNote={activeRequest && "backup" in activeRequest ? () => activeRequest.backup : captureNote}
      saveRequest={activeRequest} onClose={() => {
        setClosedRequest(saveRequest?.id ?? null); setOpen(false); onSaveRequestClose?.();
      }} />}
  </div>;
}

type RestoreAction = { onImportNote: (backup: NoteBackup) => void };
export function GoogleDriveSetupDialog({ onClose, captureNote, restore, saveRequest }: { onClose: () => void; restore?: RestoreAction } & NoteActions) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const [state, setState] = useState<SetupState>({ stage: "preparing", account: null, root: null, error: null });
  const [transferBusy, setTransferBusy] = useState(false);
  const [drive, setDrive] = useState<Runtime["drive"] | null>(null);

  function prepare(runtime: Runtime) {
    runtime.busy = true;
    return runtime.auth.prepare().then(() => {
      if (runtimeRef.current === runtime) setState({ stage: "ready", account: null, root: null, error: null });
    }).catch((error: Error) => {
      if (runtimeRef.current === runtime) setState({ stage: "error", account: null, root: null, error: error.message });
    }).finally(() => { runtime.busy = false; });
  }

  useEffect(() => {
    const runtime = { ...getGoogleDriveSession(), busy: false };
    runtimeRef.current = runtime;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const updateConnection = () => {
      const current = runtime.getConnection();
      if (runtimeRef.current !== runtime || runtime.busy) return;
      if (current) { setDrive(runtime.drive); setState({ stage: "checked", ...current, error: null }); }
      else {
        setDrive(null);
        setState((previous) => previous.stage === "checked" ? { stage: "ready", account: null, root: null,
          error: "Googleとの接続が切れました。再接続してください。" } : previous);
      }
    };
    const unsubscribe = runtime.subscribe(updateConnection);
    // getConnectionで期限を再検証。画面を開いたままでも古い確認結果を表示し続けない。
    const interval = setInterval(updateConnection, 5000);
    const connection = runtime.getConnection();
    if (connection) void Promise.resolve(connection).then((current) => {
      if (runtimeRef.current === runtime) { setDrive(runtime.drive); setState({ stage: "checked", ...current, error: null }); }
    });
    else void prepare(runtime);
    return () => {
      runtimeRef.current = null;
      unsubscribe(); clearInterval(interval);
      runtime.detach();
      if (dialog?.open) dialog.close();
    };
  }, []);

  async function checkConnection() {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.busy) return;
    runtime.busy = true;
    runtime.clear();
    setState({ stage: "checking", account: null, root: null, error: null });
    try {
      // SDK準備は完了済み。このクリック内で、awaitより前に認証ポップアップを要求する。
      await runtime.auth.connect();
      if (runtimeRef.current !== runtime) return;
      const account = await runtime.drive.getAccount();
      if (runtimeRef.current !== runtime) return;
      const root = await runtime.drive.findRoot(account.id);
      if (runtimeRef.current === runtime) { runtime.remember(account, root); setDrive(runtime.drive); setState({ stage: "checked", account, root, error: null }); }
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
      if (runtimeRef.current === runtime) { runtime.remember(account, root); setDrive(runtime.drive); setState({ stage: "checked", account, root, error: null }); }
    } catch (error) {
      if (runtimeRef.current === runtime) setState({ stage: "error", account: null, root: null,
        error: error instanceof Error ? error.message : "専用フォルダを作成できませんでした。" });
    } finally { runtime.busy = false; }
  }

  const busy = transferBusy || state.stage === "preparing" || state.stage === "checking" || state.stage === "creating";
  return <dialog ref={dialogRef} className="modal" aria-labelledby="google-drive-setup-title"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onClose={(event) => {
      // Strict Modeのeffect再実行で、一度閉じた後に再表示したdialogを古いcloseイベントで閉じない。
      if (event.target === event.currentTarget && !event.currentTarget.open) onClose();
    }}>
    <div className="modal-box flex max-h-[calc(100dvh-2rem)] max-w-md flex-col overflow-hidden rounded-box p-0">
      <h2 id="google-drive-setup-title" className="shrink-0 border-b border-base-300 px-5 py-4 text-lg font-bold">{restore ? "Driveバックアップを復元" : saveRequest ? "Driveに保存" : "Google Drive"}</h2>
      <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
        {!restore && !saveRequest && <p className="text-sm">{state.root ? "全ノート・フォルダを自動保存します。" : "接続後、全ノート・フォルダをDriveへ自動保存します。"}</p>}
        {state.account && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm break-words">
          <dt className="text-base-content/70">アカウント</dt>
          <dd className="min-w-0">{state.account.emailAddress}</dd>
          <dt className="text-base-content/70">保存先</dt>
          <dd className="min-w-0">{state.root?.name ?? "未作成"}</dd>
        </dl>}
        {busy && state.stage !== "checked" && <p role="status" className="text-sm">{state.stage === "preparing" ? "接続準備中…"
          : state.stage === "checking" ? "接続確認中…" : "専用フォルダを作成中…"}</p>}
        {state.error && <p role="alert" className="text-sm text-error">{state.error}</p>}
        {!saveRequest && !restore && <SpeedMeasurementPanel />}
        {state.stage === "checked" && state.account && state.root && drive && saveRequest && <GoogleDriveNotes
          key={`${state.account.id}:${state.root.id}`} drive={drive} accountId={state.account.id} rootId={state.root.id}
          captureNote={captureNote} initialBackup={saveRequest && "backup" in saveRequest ? saveRequest.backup : undefined}
          batchSources={saveRequest && "sources" in saveRequest ? saveRequest.sources : undefined}
          onClose={onClose} onBusyChange={setTransferBusy} />}
        {state.stage === "checked" && state.account && state.root && drive && restore && <GoogleDriveBackupRestore
          key={`${state.account.id}:${state.root.id}`} drive={drive} accountId={state.account.id} rootId={state.root.id}
          onImportNote={restore.onImportNote} onClose={onClose} onBusyChange={setTransferBusy} />}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-base-300 px-5 py-4 [&_button]:min-h-11">
        <button type="button" className="btn btn-sm" onClick={onClose}>閉じる</button>
        {state.stage === "error" && <button type="button" className="btn btn-sm" onClick={() => {
          const runtime = runtimeRef.current;
          if (!runtime || runtime.busy) return;
          setState({ stage: "preparing", account: null, root: null, error: null });
          void prepare(runtime);
        }}>接続準備をやり直す</button>}
        {!busy && state.stage !== "error" && <button type="button" className="btn btn-sm"
          onClick={() => { void checkConnection(); }}>{state.account ? "アカウントを選び直す" : "Googleで接続"}</button>}
        {state.stage === "checked" && !state.root && <button type="button" className="btn btn-sm btn-primary"
          onClick={() => { void createFolder(); }}>専用フォルダを作成</button>}
      </div>
    </div>
    <div className="modal-backdrop"><button type="button" tabIndex={-1} aria-label="Google Driveを閉じる" onClick={onClose} /></div>
  </dialog>;
}
