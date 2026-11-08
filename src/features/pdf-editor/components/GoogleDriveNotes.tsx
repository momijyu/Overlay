"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { createGoogleDriveClient } from "../googleDriveClient";
import type { DriveOverwriteTarget } from "../googleDriveNoteData";
import type { NoteBackup } from "../noteBackupData";
import type { DriveSaveSource } from "../googleDriveBatch";
import { GoogleDriveBatchSave } from "./GoogleDriveBatchSave";

type Props = {
  drive: Pick<ReturnType<typeof createGoogleDriveClient>, "findSaveTarget" | "saveConfirmedNote" | "findSaveTargetByTitle">; accountId: string; rootId: string;
  captureNote?: () => NoteBackup;
  initialBackup?: NoteBackup;
  batchSources?: DriveSaveSource[];
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
};

export function GoogleDriveNotes({ drive, accountId, rootId, captureNote, initialBackup, batchSources, onClose, onBusyChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(initialBackup ? "保存先を確認中…" : null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteBackup | null>(initialBackup ?? null);
  const [target, setTarget] = useState<DriveOverwriteTarget | null | undefined>(undefined);
  const [batchDone, setBatchDone] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const alive = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const handleBatchBusy = useCallback((value: boolean) => {
    busy.current = value; setBatchBusy(value); onBusyChange(value);
  }, [onBusyChange]);

  useEffect(() => {
    alive.current = true;
    const version = ++generation.current;
    // 通常の接続画面では一覧も本文も取得しない。選択済みの手動保存だけ準備する。
    if (initialBackup) {
      busy.current = true;
      void Promise.resolve().then(() => {
        if (!alive.current || generation.current !== version) return;
        onBusyChange(true);
        return drive.findSaveTarget(accountId, rootId, initialBackup);
      }).then((target) => {
        if (alive.current && generation.current === version) setTarget(target);
      }).catch((error: unknown) => {
        if (alive.current && generation.current === version) setError(error instanceof Error ? error.message : "保存先を確認できませんでした。");
      }).finally(() => {
        if (alive.current && generation.current === version) { busy.current = false; setWorking(null); onBusyChange(false); }
      });
    }
    return () => { alive.current = false; };
  }, [drive, accountId, rootId, initialBackup, onBusyChange]);

  async function run(label: string, action: (active: () => boolean) => Promise<void>) {
    if (busy.current || batchBusy) return;
    busy.current = true;
    const version = ++generation.current;
    setWorking(label); setMessage(null); setError(null); onBusyChange(true);
    try { await action(() => alive.current && generation.current === version); }
    catch (error) {
      if (alive.current && generation.current === version) setError(error instanceof Error ? error.message : "Driveの操作に失敗しました。");
    } finally {
      if (alive.current && generation.current === version) {
        busy.current = false; setWorking(null); onBusyChange(false);
      }
    }
  }

  const disabled = !!working || batchBusy;
  return <section className="space-y-3 border-t border-base-300 pt-3 [&_button]:min-h-11" aria-label="Driveのノート">
    {(captureNote || batchSources) && <h3 className="text-sm font-semibold">手動バックアップ</h3>}
    {batchSources && !batchDone && <GoogleDriveBatchSave sources={batchSources} drive={drive} accountId={accountId} rootId={rootId}
      disabled={!!working} onBusyChange={handleBatchBusy}
      onSaved={() => setError(null)}
      onCancel={() => { setBatchDone(true); onClose(); }} />}
    {captureNote && !batchSources && !draft && <button type="button" className="btn btn-sm w-full" disabled={disabled} onClick={() => {
      void run("保存先を確認中…", async (active) => {
        const snapshot = captureNote();
        const destination = await drive.findSaveTarget(accountId, rootId, snapshot);
        if (active()) { setDraft(snapshot); setTarget(destination); }
      });
    }}>{initialBackup ? "選択したノートを保存" : "開いているノートを保存"}</button>}
    {draft && <div className="space-y-2 rounded-box border border-base-300 p-3 text-sm">
      <p className="break-words">「{draft.notes[0].title}」をDriveへ{target ? "上書き保存" : "保存"}します。</p>
      {target && <p className="text-xs text-error">※ Driveの保存内容を置き換えます。他の端末と同時に保存しないでください。</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-xs" disabled={disabled} onClick={() => setDraft(null)}>キャンセル</button>
        <button type="button" className="btn btn-xs btn-primary" disabled={disabled} onClick={() => {
          void run("Driveへ保存中…", async (active) => {
            if (target === undefined) {
              const destination = await drive.findSaveTarget(accountId, rootId, draft);
              if (active()) setTarget(destination);
              return;
            }
            await drive.saveConfirmedNote(accountId, rootId, draft, target);
            if (!active()) return;
            setDraft(null); setTarget(undefined); setMessage(target ? "Driveへ上書き保存しました。" : "Driveへ新規保存しました。");
          });
        }}>{target === undefined ? "保存先を確認" : target ? "上書き保存" : "保存"}</button>
      </div>
    </div>}
    {working && <p role="status" className="text-sm">{working}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
  </section>;
}
