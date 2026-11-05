"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createBrowserDriveLibrary } from "../driveLibraryRuntime";
import { readLibraryStatus, resolveLibraryPlacement } from "../driveLibraryLocal";
import { LibraryConflict, type LibraryConflictItem, type LibraryEntity, type LibraryScope } from "../driveLibraryData";
import { listDriveBindings, updateDriveBinding, type DriveBinding } from "../driveOutbox";
import { subscribeDriveQueue } from "../driveQueueEvents";
import { DrivePlacementDialog } from "./DrivePlacementDialog";
import { getGoogleDriveSession } from "../googleDriveSession";

export function driveAutosaveStatus(rows: DriveBinding[], connection: { account: { id: string }; root: { id: string } | null } | null) {
  const pending = rows.filter((row) => row.enabled && row.generation > row.uploadedGeneration);
  if (!pending.length) return "";
  if (pending.some((row) => row.error)) return "Drive自動保存が停止しています。ノート一覧で確認してください。";
  if (pending.some((row) => row.accountId !== connection?.account.id || row.rootId !== connection.root?.id)) {
    return "Drive未送信のノートがあります。連携したGoogleアカウントへ再接続してください。";
  }
  return "Driveへ保存待ち…";
}

// ドロワーを閉じてもマウントを維持。モーダル内の手動送信とは寿命を分ける。
export function DriveAutosavePanel({ disabled, drawerOpen, onMutationChange }: {
  disabled: boolean; drawerOpen: boolean; onMutationChange?: (busy: boolean) => void;
}) {
  const [rows, setRows] = useState<DriveBinding[]>([]);
  const [connected, setConnected] = useState<ReturnType<ReturnType<typeof getGoogleDriveSession>["getConnection"]>>(null);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<LibraryScope | null>(null);
  const [treePending, setTreePending] = useState(false);
  const [conflict, setConflict] = useState<LibraryConflictItem | null>(null);
  const [entities, setEntities] = useState<LibraryEntity[]>([]);
  const runnerRef = useRef<ReturnType<typeof createBrowserDriveLibrary> | null>(null);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const session = getGoogleDriveSession();
    const runner = createBrowserDriveLibrary();
    runnerRef.current = runner;
    const canSync = !!navigator.locks && !!crypto.subtle;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const current = await listDriveBindings();
        if (!active) return;
        setSupported(canSync);
        setRows((previous) => JSON.stringify(previous) === JSON.stringify(current) ? previous : current);
        setConnected(session.getConnection());
        const library = await readLibraryStatus();
        if (!active) return;
        setScope(library.scope); setEntities(library.entities); setTreePending(library.pending);
        // 通信が長くても状態取得を止めない。runner自身が同時送信を防ぐ。
        if (canSync) void runner.tick().then((completed) => { if (active && completed) setError(null); }).catch((cause: unknown) => { if (active) { setError(cause instanceof Error ? cause.message : "Drive連携を確認できませんでした。"); if (cause instanceof LibraryConflict) setConflict(cause.conflicts[0]); } });
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Drive自動保存を確認できませんでした。");
      } finally { refreshing = false; }
    };
    const unsubscribeQueue = subscribeDriveQueue(() => { void refresh(); });
    const unsubscribeSession = session.subscribe(() => { void refresh(); });
    const interval = setInterval(() => { void refresh(); }, 1000);
    window.addEventListener("online", refresh);
    void refresh();
    return () => { active = false; clearInterval(interval); unsubscribeQueue(); unsubscribeSession(); window.removeEventListener("online", refresh); runnerRef.current = null; runner.dispose(); };
  }, []);
  const status = (error ? "Drive連携が停止しています。ノート一覧で確認してください。" : driveAutosaveStatus(rows, connected)) || (treePending ? "Driveへ階層を保存待ち…" : "");
  useEffect(() => {
    if (!status) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);
  const matchingConnection = connected?.root && (!scope || scope.accountId === connected.account.id && scope.rootId === connected.root.id);
  async function retryLibrary() {
    setBusy(true); setError(null);
    try {
      const connection = getGoogleDriveSession().getConnection();
      for (const row of rows) if (row.enabled && row.error && row.accountId === connection?.account.id && row.rootId === connection.root?.id) {
        await updateDriveBinding(row.id, row.key, (live) => ({ ...live, error: undefined, retryAt: undefined, failures: 0 }));
      }
      await runnerRef.current?.tick(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Drive一覧を更新できませんでした。"); if (cause instanceof LibraryConflict) setConflict(cause.conflicts[0]); }
    finally { setBusy(false); }
  }
  return <>
    {conflict && <DrivePlacementDialog conflict={conflict} entities={entities} busy={busy} onClose={() => setConflict(null)}
      onChoose={(head) => {
        setBusy(true); setError(null); onMutationChange?.(true);
        void resolveLibraryPlacement(conflict, head).then(() => { setConflict(null); return runnerRef.current?.tick(true); })
          .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : "配置を確定できませんでした。"); if (cause instanceof LibraryConflict) setConflict(cause.conflicts[0]); })
          .finally(() => { setBusy(false); onMutationChange?.(false); });
      }} />}
    <section aria-label="Drive自動保存" className="mx-4 my-3 border-t border-base-300 pt-3">
      <h2 className="text-sm font-semibold">Drive自動保存</h2>
      <p className="mt-2 text-xs">{scope ? "全ノート・フォルダをDriveへ自動保存します。" : "Drive接続後、全ノート・フォルダを自動保存します。"}</p>
      {connected?.root && <button type="button" className="btn btn-sm mt-2" disabled={disabled || busy || !supported || !matchingConnection}
        onClick={() => void retryLibrary()}>Drive一覧を更新・再試行</button>}
      {!supported && <p className="mt-2 text-xs">自動保存にはHTTPSまたはlocalhostの対応ブラウザが必要です。</p>}
      {!matchingConnection && <p className="mt-2 text-xs">下の「Google Driveの接続確認」から接続してください。</p>}
      <p className="mt-2 text-xs text-base-content/70">端末ごとに別の保存先を作ります。未送信の間はこのブラウザに保管します。</p>
      {status && <p role="status" className="mt-2 text-xs">{status}</p>}
      {(error || rows.some((row) => row.enabled && row.error)) && <p role="alert" className="mt-2 text-xs text-error">{error || rows.find((row) => row.enabled && row.error)?.error}</p>}
    </section>
    {!drawerOpen && status && typeof document !== "undefined" && createPortal(
      <div className="pointer-events-none fixed bottom-3 right-3 z-30 max-w-[calc(100vw-1.5rem)] rounded-box border border-base-300 bg-base-100 px-3 py-2 text-xs shadow-sm" role="status">{status}</div>, document.body)}
  </>;
}
