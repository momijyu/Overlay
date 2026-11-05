"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { createGoogleDriveClient } from "../googleDriveClient";
import type { DriveNoteSummary, DriveOverwriteTarget } from "../googleDriveNoteData";
import type { NoteBackup } from "../noteBackupData";
import type { DriveSaveSource } from "../googleDriveBatch";
import { GoogleDriveBatchSave } from "./GoogleDriveBatchSave";

type Props = {
  drive: Pick<ReturnType<typeof createGoogleDriveClient>, "listNotes" | "findSaveTarget" | "saveConfirmedNote" | "loadNote" | "findSaveTargetByTitle">; accountId: string; rootId: string;
  captureNote?: () => NoteBackup;
  initialBackup?: NoteBackup;
  batchSources?: DriveSaveSource[];
  onImportNote?: (backup: NoteBackup) => void;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
};
type ListState = { notes: DriveNoteSummary[]; nextPageToken?: string; loading: boolean; error: string | null };

export function GoogleDriveNotes({ drive, accountId, rootId, captureNote, initialBackup, batchSources, onImportNote, onClose, onBusyChange }: Props) {
  const [list, setList] = useState<ListState>({ notes: [], loading: true, error: null });
  const [working, setWorking] = useState<string | null>(null);
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
    void Promise.all([drive.listNotes(accountId, rootId), initialBackup ? drive.findSaveTarget(accountId, rootId, initialBackup) : undefined]).then(([page, target]) => {
      if (alive.current && generation.current === version) { setList({ ...page, loading: false, error: null }); setTarget(target); }
    }).catch((error: Error) => {
      if (alive.current && generation.current === version) setList({ notes: [], loading: false, error: error.message });
    });
    return () => { alive.current = false; };
  }, [drive, accountId, rootId, initialBackup]);

  async function run(label: string, action: () => Promise<void>) {
    if (busy.current || list.loading || batchBusy) return;
    busy.current = true;
    const version = ++generation.current;
    setWorking(label); setMessage(null); setList({ ...list, error: null }); onBusyChange(true);
    try { await action(); }
    catch (error) {
      if (alive.current && generation.current === version) setList((previous) => ({ ...previous,
        error: error instanceof Error ? error.message : "Driveの操作に失敗しました。" }));
    } finally {
      busy.current = false;
      if (alive.current && generation.current === version) { setWorking(null); onBusyChange(false); }
    }
  }

  async function refresh(append = false) {
    const token = append ? list.nextPageToken : undefined;
    const page = await drive.listNotes(accountId, rootId, token);
    if (!alive.current) return;
    if (token && page.nextPageToken === token) throw new Error("Drive一覧の続き情報を確認できません。更新してください。");
    const combined = append ? [...list.notes, ...page.notes] : page.notes;
    setList({ notes: [...new Map(combined.map((note) => [note.id, note])).values()], nextPageToken: page.nextPageToken, loading: false, error: null });
  }

  const disabled = !!working || list.loading || batchBusy;
  return <section className="space-y-3 border-t border-base-300 pt-3 [&_button]:min-h-11" aria-label="Driveのノート">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">Driveのノート</h3>
      <button type="button" className="btn btn-xs" disabled={disabled} onClick={() => { void run("一覧を更新中…", () => refresh()); }}>更新</button>
    </div>
    {batchSources && !batchDone && !list.loading && <GoogleDriveBatchSave sources={batchSources} drive={drive} accountId={accountId} rootId={rootId}
      disabled={!!working} onBusyChange={handleBatchBusy}
      onSaved={(saved) => setList((previous) => ({ ...previous, error: null, notes: [saved, ...previous.notes.filter((note) => note.id !== saved.id)] }))}
      onCancel={() => { setBatchDone(true); onClose(); }} />}
    {captureNote && !batchSources && !draft && <button type="button" className="btn btn-sm w-full" disabled={disabled} onClick={() => {
      void run("保存先を確認中…", async () => {
        const snapshot = captureNote();
        const destination = await drive.findSaveTarget(accountId, rootId, snapshot);
        if (alive.current) { setDraft(snapshot); setTarget(destination); }
      });
    }}>{initialBackup ? "選択したノートを保存" : "開いているノートを保存"}</button>}
    {draft && <div className="space-y-2 rounded-box border border-base-300 p-3 text-sm">
      <p className="break-words">「{draft.notes[0].title}」をDriveへ{target ? "上書き保存" : "保存"}します。</p>
      {target && <p className="text-xs text-error">※ Driveの保存内容を置き換えます。他の端末と同時に保存しないでください。</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-xs" disabled={disabled} onClick={() => setDraft(null)}>キャンセル</button>
        <button type="button" className="btn btn-xs btn-primary" disabled={disabled} onClick={() => {
          void run("Driveへ保存中…", async () => {
            if (target === undefined) {
              const destination = await drive.findSaveTarget(accountId, rootId, draft);
              if (alive.current) setTarget(destination);
              return;
            }
            const saved = await drive.saveConfirmedNote(accountId, rootId, draft, target);
            if (!alive.current) return;
            setDraft(null); setTarget(undefined); setMessage(target ? "Driveへ上書き保存しました。" : "Driveへ新規保存しました。");
            // 保存応答は所有者・保存場所・形式まで検証済み。再検索を待たず、結果を小さな一覧へ反映する。
            // 他端末での変更は既存の「更新」から取得し、PDFや編集本文のキャッシュは増やさない。
            setList((previous) => ({ ...previous, error: null,
              notes: [saved, ...previous.notes.filter((note) => note.id !== saved.id)] }));
          });
        }}>{target === undefined ? "保存先を確認" : target ? "上書き保存" : "保存"}</button>
      </div>
    </div>}
    {list.loading && <p role="status" className="text-sm">Driveの一覧を取得中…</p>}
    {working && <p role="status" className="text-sm">{working}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {list.error && <p role="alert" className="text-sm text-error">{list.error}</p>}
    {!list.loading && !list.error && list.notes.length === 0 && <p className="text-sm">Driveのノートはありません。</p>}
    <ul className="max-h-56 space-y-2 overflow-y-auto">
      {list.notes.map((note) => <li key={note.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-box border border-base-300 p-2">
        <span className="min-w-0 flex-1 break-words text-sm">{note.title}
          {note.deviceId && <span className="block text-xs text-base-content/60">自動保存・端末 {note.deviceId.slice(0, 8)}・{new Date(note.updatedAt).toLocaleString("ja-JP")}</span>}
        </span>
        {onImportNote && <button type="button" className="btn btn-xs" disabled={disabled} onClick={() => {
          void run("ノートを読み込み中…", async () => {
            const backup = await drive.loadNote(accountId, rootId, note.id);
            if (!alive.current) return;
            onImportNote(backup); onClose();
          });
        }}>ブラウザへコピー</button>}
      </li>)}
    </ul>
    {list.nextPageToken && <button type="button" className="btn btn-sm w-full" disabled={disabled}
      onClick={() => { void run("一覧の続きを取得中…", () => refresh(true)); }}>さらに表示</button>}
  </section>;
}
