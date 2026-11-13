"use client";

import { useEffect, useState } from "react";
import { DEFAULT_DRIVE_CACHE_MB, MIN_DRIVE_CACHE_MB, MAX_DRIVE_CACHE_MB, saveDriveCacheLimit } from "../driveCacheSettings";
import { readDriveCacheSummary } from "../driveLibraryCache";
import { subscribeDriveQueue } from "../driveQueueEvents";

export function DriveCacheSettings({ visible = true }: { visible?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(DEFAULT_DRIVE_CACHE_MB);
  const [draft, setDraft] = useState(String(DEFAULT_DRIVE_CACHE_MB));
  const [bytes, setBytes] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => {
    // 一覧を閉じた編集画面では、非表示の容量表示のために全キャッシュを走査しない。
    // 自動保存・未送信の監視とキャッシュ整理は別のrunnerが継続する。
    if (!visible || !open) return;
    let active = true; let reading = false; let again = false;
    async function refresh() {
      if (!active) return;
      if (reading) { again = true; return; }
      reading = true;
      try {
        const summary = await readDriveCacheSummary();
        if (!active) return;
        setBytes(summary.bytes); setLimit(summary.limitMB); setReady(true);
        setReadError(null);
        // 入力途中の数値は定期更新で書き換えない。
        setDraft((previous) => previous === String(limit) ? String(summary.limitMB) : previous);
      } catch (cause) { if (active) setReadError(cause instanceof Error ? cause.message : "容量を確認できませんでした。"); }
      finally {
        reading = false;
        if (again && active) { again = false; void refresh(); }
      }
    }
    void refresh();
    const unsubscribe = open ? subscribeDriveQueue(() => { void refresh(); }) : () => {};
    const interval = open ? setInterval(() => { void refresh(); }, 5000) : undefined;
    return () => { active = false; unsubscribe(); clearInterval(interval); };
  }, [open, limit, visible, retry]);
  const value = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(value) && value >= MIN_DRIVE_CACHE_MB && value <= MAX_DRIVE_CACHE_MB;
  async function apply() {
    if (busy || !ready || !valid) return;
    setBusy(true); setError(null); setMessage("");
    try { await saveDriveCacheLimit(value); setLimit(value); setMessage("設定しました。"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "設定を保存できませんでした。"); }
    finally { setBusy(false); }
  }
  return <details className="mt-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer py-2 text-sm">Driveデータの一時保存容量</summary>
    <form className="flex min-w-0 flex-col gap-3 pt-2" onSubmit={(event) => { event.preventDefault(); void apply(); }}>
      <label className="text-xs" htmlFor="drive-cache-limit">上限（MB）</label>
      <input type="range" className="range range-sm w-full" min={MIN_DRIVE_CACHE_MB} max={MAX_DRIVE_CACHE_MB} step="1"
        aria-label="Driveデータの一時保存容量の上限" value={valid ? value : limit} disabled={!ready || busy}
        onChange={(event) => { setDraft(event.target.value); setMessage(""); }} />
      <div className="flex min-w-0 items-center gap-2">
        <input id="drive-cache-limit" type="number" className="input input-sm min-w-0 w-28" min={MIN_DRIVE_CACHE_MB} max={MAX_DRIVE_CACHE_MB} step="1"
          value={draft} disabled={!ready || busy} onChange={(event) => { setDraft(event.target.value); setMessage(""); }} />
        <span className="text-xs">MB</span>
        <button type="submit" className="btn btn-sm" disabled={!ready || busy || !valid || value === limit}>適用</button>
      </div>
      <p className="text-xs">{ready ? `使用量：約${(bytes / 1_000_000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}MB ／ 上限${limit}MB` : readError ? "容量を取得できませんでした。" : "容量を確認中…"}</p>
      <p className="text-xs text-base-content/70">Driveから取得したデータの一時保存に適用します。未送信・使用中のデータと、ブラウザだけのノートは自動削除しません。</p>
      {message && <p role="status" className="text-xs">{message}</p>}
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
      {readError && <div className="flex min-w-0 items-center gap-2">
        <p role="alert" className="min-w-0 break-words text-xs text-error">{readError}</p>
        <button type="button" className="btn btn-sm shrink-0" disabled={busy} onClick={() => setRetry((value) => value + 1)}>再取得</button>
      </div>}
    </form>
  </details>;
}
