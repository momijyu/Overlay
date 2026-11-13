"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createBrowserDriveLibrary } from "../driveLibraryRuntime";
import { readLibraryPending, readLibraryStatus, resolveLibraryPlacement } from "../driveLibraryLocal";
import { LibraryConflict, type LibraryConflictItem, type LibraryEntity, type LibraryScope } from "../driveLibraryData";
import { listDriveBindings, updateDriveBinding, type DriveBinding } from "../driveOutbox";
import { subscribeDriveQueue } from "../driveQueueEvents";
import { DrivePlacementDialog } from "./DrivePlacementDialog";
import { getGoogleDriveSession } from "../googleDriveSession";
import { DriveCacheSettings } from "./DriveCacheSettings";
import { DriveStickyIndexError } from "../driveStickyIndexData";

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
export function DriveAutosavePanel({ disabled, drawerOpen, onMutationChange, children }: {
  disabled: boolean; drawerOpen: boolean; onMutationChange?: (busy: boolean) => void; children?: ReactNode;
}) {
  const [rows, setRows] = useState<DriveBinding[]>([]);
  const [connected, setConnected] = useState<ReturnType<ReturnType<typeof getGoogleDriveSession>["getConnection"]>>(null);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexOnlyError, setIndexOnlyError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<LibraryScope | null>(null);
  const [treePending, setTreePending] = useState(false);
  const [conflict, setConflict] = useState<LibraryConflictItem | null>(null);
  const [entities, setEntities] = useState<LibraryEntity[]>([]);
  const runnerRef = useRef<ReturnType<typeof createBrowserDriveLibrary> | null>(null);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    let refreshRequested = false;
    const session = getGoogleDriveSession();
    const runner = createBrowserDriveLibrary();
    runnerRef.current = runner;
    const canSync = !!navigator.locks && !!crypto.subtle;
    const showFailure = (cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Drive連携を確認できませんでした。");
      setIndexOnlyError(cause instanceof DriveStickyIndexError);
      if (cause instanceof LibraryConflict) void readLibraryStatus().then((library) => {
        if (active) { setEntities(library.entities); setConflict(cause.conflicts[0]); }
      }).catch(() => { /* 確認に失敗した場合も既存内容を維持する。 */ });
    };
    const run = () => {
      if (canSync) void runner.tick().then((completed) => { if (active && completed) setError(null); }).catch(showFailure);
    };
    const refresh = async () => {
      if (!active) return;
      // DB確認中の接続・送信完了通知も取りこぼさず、重複分は次の1回にまとめる。
      if (refreshing) { refreshRequested = true; return; }
      refreshing = true;
      try {
        const current = await listDriveBindings();
        const library = await readLibraryPending();
        if (!active) return;
        const connection = session.getConnection();
        setSupported(canSync);
        setRows((previous) => JSON.stringify(previous) === JSON.stringify(current) ? previous : current);
        setConnected((previous) => JSON.stringify(previous) === JSON.stringify(connection) ? previous : connection);
        setScope((previous) => JSON.stringify(previous) === JSON.stringify(library.scope) ? previous : library.scope);
        setTreePending(library.pending);
      } catch (cause) { showFailure(cause); }
      finally {
        refreshing = false;
        if (active && refreshRequested) { refreshRequested = false; void refresh(); }
      }
    };
    const changed = () => { void refresh(); run(); };
    const connectionChanged = () => {
      // DBを待たず失効・再接続を表示する。取得完了時も最新の認可を読み直す。
      if (active) setConnected(session.getConnection());
      changed();
    };
    const unsubscribeQueue = subscribeDriveQueue(changed);
    const unsubscribeSession = session.subscribe(connectionChanged);
    // 送信の時刻判定は軽いハートビート。UIは変更通知と別タブ用の低頻度確認で更新する。
    const heartbeat = setInterval(run, 1000);
    const interval = setInterval(() => { void refresh(); }, 5000);
    window.addEventListener("online", changed);
    changed();
    return () => { active = false; clearInterval(heartbeat); clearInterval(interval); unsubscribeQueue(); unsubscribeSession(); window.removeEventListener("online", changed); runnerRef.current = null; runner.dispose(); };
  }, []);
  const pendingStatus = driveAutosaveStatus(rows, connected) || (treePending ? "Driveへ階層を保存待ち…" : "");
  const status = error && !indexOnlyError ? "Drive連携が停止しています。ノート一覧で確認してください。"
    : pendingStatus || (error ? "付箋一覧を更新できません。ノート本文の自動保存は継続します。" : "");
  const needsUnloadWarning = !!pendingStatus || !!error && !indexOnlyError;
  useEffect(() => {
    if (!needsUnloadWarning) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [needsUnloadWarning]);
  const matchingConnection = connected?.root && (!scope || scope.accountId === connected.account.id && scope.rootId === connected.root.id);
  function showConflict(cause: LibraryConflict) {
    void readLibraryStatus().then((library) => {
      setEntities(library.entities); setConflict(cause.conflicts[0]);
    }).catch(() => { /* 読み直し失敗時も既存のエラーと内容を残す。 */ });
  }
  async function retryLibrary() {
    setBusy(true); setError(null);
    try {
      const connection = getGoogleDriveSession().getConnection();
      for (const row of rows) if (row.enabled && row.error && row.accountId === connection?.account.id && row.rootId === connection.root?.id) {
        await updateDriveBinding(row.id, row.key, (live) => ({ ...live, error: undefined, retryAt: undefined, failures: 0 }));
      }
      await runnerRef.current?.tick(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Drive一覧を更新できませんでした。"); setIndexOnlyError(cause instanceof DriveStickyIndexError); if (cause instanceof LibraryConflict) showConflict(cause); }
    finally { setBusy(false); }
  }
  return <>
    {conflict && <DrivePlacementDialog conflict={conflict} entities={entities} busy={busy} onClose={() => setConflict(null)}
      onChoose={(head) => {
        setBusy(true); setError(null); onMutationChange?.(true);
        void resolveLibraryPlacement(conflict, head).then(() => { setConflict(null); return runnerRef.current?.tick(true); })
          .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : "配置を確定できませんでした。"); setIndexOnlyError(cause instanceof DriveStickyIndexError); if (cause instanceof LibraryConflict) showConflict(cause); })
          .finally(() => { setBusy(false); onMutationChange?.(false); });
      }} />}
    <section aria-label="Drive自動保存" className="mx-4 my-3 border-t border-base-300 pt-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Google Drive</h2>
        {children}
      </div>
      <p className="mt-2 text-xs text-base-content/70" data-drive-connection-status>
        {connected?.root ? matchingConnection ? "接続中・自動保存" : "接続先を確認してください。"
          : connected ? "保存先を設定してください。" : scope || rows.some((row) => row.enabled) ? "再接続が必要です。" : "未接続・ブラウザに保存"}
      </p>
      <p className="mt-2 text-xs">{!connected
        ? scope || rows.some((row) => row.enabled)
          ? "編集はこのブラウザに保存します。Driveへ送るには接続設定から再接続してください。"
          : "接続すると全ノート・フォルダをDriveへ自動保存します。"
        : matchingConnection ? "全ノート・フォルダをDriveへ自動保存します。"
          : "接続設定で保存先を確認してください。"}</p>
      {connected?.root && <button type="button" className="btn btn-sm mt-2" disabled={disabled || busy || !supported || !matchingConnection}
        onClick={() => void retryLibrary()}>Drive一覧を更新・再試行</button>}
      {!supported && <p className="mt-2 text-xs">自動保存にはHTTPSまたはlocalhostの対応ブラウザが必要です。</p>}
      {status && <p role="status" className="mt-2 text-xs">{status}</p>}
      {(error || rows.some((row) => row.enabled && row.error)) && <p role="alert" className="mt-2 text-xs text-error">{rows.find((row) => row.enabled && row.error)?.error || error}</p>}
      <DriveCacheSettings visible={drawerOpen} />
    </section>
    {!drawerOpen && status && typeof document !== "undefined" && createPortal(
      <div className="pointer-events-none fixed bottom-3 right-3 z-30 max-w-[calc(100vw-1.5rem)] rounded-box border border-base-300 bg-base-100 px-3 py-2 text-xs shadow-sm" role="status">{status}</div>, document.body)}
  </>;
}
