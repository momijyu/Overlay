"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createBrowserDriveAutosave } from "../driveAutosave";
import { enableDriveAutosave, listDriveBindings, updateDriveBinding, type DriveBinding } from "../driveOutbox";
import { subscribeDriveQueue } from "../driveQueueEvents";
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
export function DriveAutosavePanel({ noteId, title, disabled, drawerOpen }: {
  noteId: string | null; title: string; disabled: boolean; drawerOpen: boolean;
}) {
  const [rows, setRows] = useState<DriveBinding[]>([]);
  const [connected, setConnected] = useState<ReturnType<ReturnType<typeof getGoogleDriveSession>["getConnection"]>>(null);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const session = getGoogleDriveSession();
    const runner = createBrowserDriveAutosave();
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
        if (canSync) await runner.tick();
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Drive自動保存を確認できませんでした。");
      } finally { refreshing = false; }
    };
    const unsubscribeQueue = subscribeDriveQueue(() => { void refresh(); });
    const unsubscribeSession = session.subscribe(() => { void refresh(); });
    const interval = setInterval(() => { void refresh(); }, 1000);
    window.addEventListener("online", refresh);
    void refresh();
    return () => { active = false; clearInterval(interval); unsubscribeQueue(); unsubscribeSession(); window.removeEventListener("online", refresh); runner.dispose(); };
  }, []);
  const status = driveAutosaveStatus(rows, connected);
  useEffect(() => {
    if (!status) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);
  const binding = rows.find((row) => row.id === noteId);
  const matchingConnection = connected?.root && (!binding || binding.accountId === connected.account.id && binding.rootId === connected.root.id);
  async function change(action: "enable" | "pause" | "retry") {
    if (!noteId || busy) return;
    setBusy(true); setError(null);
    try {
      if (action === "enable") {
        const connection = getGoogleDriveSession().getConnection();
        if (!connection?.root) throw new Error("先にGoogle Driveの接続確認を行ってください。");
        await enableDriveAutosave(noteId, connection.account.id, connection.root.id);
      } else if (binding) {
        await updateDriveBinding(noteId, binding.key, (row) => ({ ...row, enabled: action === "retry", error: undefined, retryAt: undefined, failures: 0 }));
      }
      setRows(await listDriveBindings());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Drive自動保存を変更できませんでした。"); }
    finally { setBusy(false); }
  }
  return <>
    <section aria-label="Drive自動保存" className="mx-4 my-3 border-t border-base-300 pt-3">
      <h2 className="text-sm font-semibold">Drive自動保存</h2>
      {noteId ? <>
        <p className="mt-2 truncate text-sm" title={title}>{title}</p>
        <p role="status" className="mt-1 text-xs text-base-content/70">{binding?.enabled
          ? binding.error ? "停止中" : binding.generation > binding.uploadedGeneration ? "送信待ち" : "Driveに保存済み"
          : binding ? "一時停止中" : "未設定"}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {!binding?.enabled && <button type="button" className="btn btn-sm" disabled={disabled || busy || !supported || !matchingConnection}
            onClick={() => void change("enable")}>このノートで有効にする</button>}
          {binding?.enabled && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void change("pause")}>一時停止</button>}
          {binding?.enabled && (binding.error || binding.retryAt) && <button type="button" className="btn btn-sm" disabled={busy || !matchingConnection}
            onClick={() => void change("retry")}>再試行</button>}
        </div>
      </> : <p className="mt-2 text-xs">保存済みのノートを開いてください。</p>}
      {!supported && <p className="mt-2 text-xs">自動保存にはHTTPSまたはlocalhostの対応ブラウザが必要です。</p>}
      {!matchingConnection && <p className="mt-2 text-xs">下の「Google Driveの接続確認」から接続してください。</p>}
      <p className="mt-2 text-xs text-base-content/70">端末ごとに別の保存先を作ります。未送信の間はこのブラウザに保管します。</p>
      {status && <p role="status" className="mt-2 text-xs">{status}</p>}
      {(error || binding?.error) && <p role="alert" className="mt-2 text-xs text-error">{error || binding?.error}</p>}
    </section>
    {!drawerOpen && status && typeof document !== "undefined" && createPortal(
      <div className="pointer-events-none fixed bottom-3 right-3 z-30 max-w-[calc(100vw-1.5rem)] rounded-box border border-base-300 bg-base-100 px-3 py-2 text-xs shadow-sm" role="status">{status}</div>, document.body)}
  </>;
}
