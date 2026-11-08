"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { createGoogleDriveClient } from "../googleDriveClient";
import type { DriveNoteSummary } from "../googleDriveNoteData";
import type { NoteBackup } from "../noteBackupData";

type Props = {
  drive: Pick<ReturnType<typeof createGoogleDriveClient>, "listNotes" | "loadNote">;
  accountId: string;
  rootId: string;
  onImportNote: (backup: NoteBackup) => void;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
};
type ListState = { notes: DriveNoteSummary[]; nextPageToken?: string; loading: boolean; error: string | null };

// 通常のクラウド一覧とは別に、以前の手動バックアップを復元する明示的な入口だけで使う。
export function GoogleDriveBackupRestore({ drive, accountId, rootId, onImportNote, onClose, onBusyChange }: Props) {
  const [list, setList] = useState<ListState>({ notes: [], loading: true, error: null });
  const [working, setWorking] = useState<string | null>(null);
  const alive = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);

  const run = useCallback(async (label: string, action: (active: () => boolean) => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    const version = ++generation.current;
    setWorking(label); setList((previous) => ({ ...previous, error: null })); onBusyChange(true);
    try { await action(() => alive.current && generation.current === version); }
    catch (error) {
      if (alive.current && generation.current === version) setList((previous) => ({ ...previous,
        error: error instanceof Error ? error.message : "バックアップを取得できませんでした。" }));
    } finally {
      if (alive.current && generation.current === version) {
        busy.current = false; setWorking(null); setList((previous) => ({ ...previous, loading: false })); onBusyChange(false);
      }
    }
  }, [onBusyChange]);

  const fetchPage = useCallback(async (active: () => boolean, token?: string, previous: DriveNoteSummary[] = []) => {
    setList((list) => ({ ...list, loading: true }));
    const page = await drive.listNotes(accountId, rootId, token);
    if (!active()) return;
    if (token && page.nextPageToken === token) throw new Error("Drive一覧の続き情報を確認できません。更新してください。");
    setList({ notes: [...new Map([...previous, ...page.notes].map((note) => [note.id, note])).values()],
      nextPageToken: page.nextPageToken, loading: false, error: null });
  }, [drive, accountId, rootId]);

  useEffect(() => {
    alive.current = true;
    const version = ++generation.current;
    // Strict Modeの準備→破棄では通信せず、実際に残った画面からだけ取得する。
    void Promise.resolve().then(() => {
      if (alive.current && generation.current === version) return run("バックアップの一覧を取得中…", (active) => fetchPage(active));
    });
    return () => { alive.current = false; busy.current = false; };
  }, [run, fetchPage]);

  const disabled = !!working || list.loading;
  return <section className="space-y-3 border-t border-base-300 pt-3 [&_button]:min-h-11" aria-label="Driveバックアップの復元">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm">別のノートとして復元します。</p>
      <button type="button" className="btn btn-sm" disabled={disabled}
        onClick={() => { void run("バックアップの一覧を取得中…", (active) => fetchPage(active)); }}>更新</button>
    </div>
    {working && <p role="status" className="text-sm">{working}</p>}
    {list.error && <p role="alert" className="text-sm text-error">{list.error}</p>}
    {!list.loading && !list.error && list.notes.length === 0 && <p className="text-sm">Driveのバックアップはありません。</p>}
    <ul className="space-y-2">
      {list.notes.map((note) => <li key={note.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-box border border-base-300 p-2">
        <span className="min-w-0 flex-1 break-words text-sm">{note.title}
          <span className="block text-xs text-base-content/60">保存日時：{Number.isFinite(Date.parse(note.updatedAt)) ? new Date(note.updatedAt).toLocaleString("ja-JP") : "不明"}</span>
        </span>
        <button type="button" className="btn btn-sm" disabled={disabled} onClick={() => {
          void run("バックアップを読み込み中…", async (active) => {
            const backup = await drive.loadNote(accountId, rootId, note.id);
            if (!active()) return;
            onImportNote(backup); onClose();
          });
        }}>復元</button>
      </li>)}
    </ul>
    {list.nextPageToken && <button type="button" className="btn btn-sm w-full" disabled={disabled}
      onClick={() => { void run("一覧の続きを取得中…", (active) => fetchPage(active, list.nextPageToken, list.notes)); }}>さらに表示</button>}
  </section>;
}
