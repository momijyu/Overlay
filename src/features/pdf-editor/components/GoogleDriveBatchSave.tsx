"use client";

import { useEffect, useRef, useState } from "react";
import { createDriveBatch, prepareDriveBatch, saveDriveBatch, type DriveBatchAccess, type DriveBatchEntry, type DriveSaveSource } from "../googleDriveBatch";
import type { DriveNoteSummary } from "../googleDriveNoteData";

type Props = { sources: DriveSaveSource[]; drive: DriveBatchAccess; accountId: string; rootId: string;
  disabled?: boolean; onBusyChange: (busy: boolean) => void; onSaved: (note: DriveNoteSummary) => void; onCancel: () => void };

export function GoogleDriveBatchSave({ sources, drive, accountId, rootId, disabled, onBusyChange, onSaved, onCancel }: Props) {
  const [entries, setEntries] = useState<DriveBatchEntry[]>([]);
  const [working, setWorking] = useState<string | null>("保存先を確認中…");
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    alive.current = true;
    const version = ++generation.current;
    busy.current = true;
    onBusyChange(true);
    void Promise.resolve().then(async () => {
      const selected = createDriveBatch(sources);
      if (alive.current && generation.current === version) setEntries(selected);
      await prepareDriveBatch(selected, drive, accountId, rootId, () => alive.current && generation.current === version, setEntries);
    }).catch((error: Error) => {
      if (alive.current && generation.current === version) setError(error.message);
    }).finally(() => {
      if (alive.current && generation.current === version) { busy.current = false; setWorking(null); onBusyChange(false); }
    });
    return () => { alive.current = false; };
  }, [sources, drive, accountId, rootId, onBusyChange]);

  async function run(label: string, action: (active: () => boolean) => Promise<unknown>) {
    if (busy.current || disabled) return;
    busy.current = true; const version = ++generation.current;
    setWorking(label); setError(null); onBusyChange(true);
    const active = () => alive.current && generation.current === version;
    try { await action(active); }
    catch (error) { if (active()) setError(error instanceof Error ? error.message : "一括保存に失敗しました。"); }
    finally { if (active()) { busy.current = false; setWorking(null); onBusyChange(false); } }
  }
  const completed = entries.filter((entry) => entry.status === "saved").length;
  const ready = entries.length > completed && entries.every((entry) => entry.status === "ready" || entry.status === "saved");
  const failed = entries.some((entry) => entry.status === "failed");
  const overwrites = entries.filter((entry) => entry.status !== "saved" && entry.target).length;
  return <div className="space-y-3 rounded-box border border-base-300 p-3 text-sm" aria-label="選択したノートのDrive保存">
    <p>選択したノート{sources.length}件をDriveへ保存します。</p>
    <p className="text-xs text-base-content/70">ノートを個別に保存します。フォルダの階層は保存しません。</p>
    <ul className="max-h-48 space-y-2 overflow-y-auto">
      {entries.map((entry) => <li key={entry.source.id} className="break-words">
        <span>{entry.source.title}</span>
        {entry.saveTitle && <p className="text-xs text-base-content/70">保存名：{entry.saveTitle}</p>}
        <span className="ms-2 text-xs">{entry.status === "saved" ? "保存済み" : entry.status === "saving" ? "保存中…"
          : entry.status === "failed" ? "要確認" : entry.target === undefined ? "未確認" : entry.target ? "上書き" : "新規"}</span>
        {entry.error && <p role="alert" className="mt-1 text-xs text-error">{entry.error}</p>}
      </li>)}
    </ul>
    {!!overwrites && <p className="text-xs text-error">※ 同名の{overwrites}件を上書きします。他の端末と同時に保存しないでください。</p>}
    <p role="status">{working ?? (sources.length > 0 && completed === sources.length ? `${completed}件を保存しました。`
      : completed ? `${completed}件保存済み・残り${sources.length - completed}件` : "対象と保存方法を確認してください。")}</p>
    {failed && <p className="text-xs text-error">※ 保存結果を確認してから、残りの保存先を確認し直してください。保存済みの項目は再送しません。</p>}
    {error && <p role="alert" className="text-xs text-error">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" className="btn btn-xs" disabled={!!working || disabled} onClick={onCancel}>{completed === sources.length ? "完了" : "キャンセル"}</button>
      {!working && entries.length > completed && !ready && <button type="button" className="btn btn-xs" disabled={disabled} onClick={() => {
        void run("保存先を確認中…", (active) => prepareDriveBatch(entries, drive, accountId, rootId, active, setEntries));
      }}>残りの保存先を確認</button>}
      {ready && <button type="button" className="btn btn-xs btn-primary" disabled={!!working || disabled} onClick={() => {
        void run("Driveへ保存中…", (active) => saveDriveBatch(entries, drive, accountId, rootId, active, setEntries, onSaved));
      }}>{overwrites ? "上書きを含めて保存" : "まとめて保存"}</button>}
    </div>
  </div>;
}
