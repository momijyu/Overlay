import { useEffect, useRef } from "react";
import type { NoteBackup } from "../noteBackupData";

export function NotebookRestoreDialog({ backup, skipDuplicates = false, busy, error, onClose, onRestore }: {
  backup: NoteBackup; skipDuplicates?: boolean; busy: boolean; error: string | null;
  onClose: () => void; onRestore: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return <dialog ref={dialogRef} className="modal" aria-labelledby="backup-restore-heading"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form className="modal-box flex max-h-[calc(100dvh-2rem)] max-w-md flex-col overflow-hidden rounded-box" onSubmit={(event) => { event.preventDefault(); if (!busy) onRestore(); }}>
      <h2 id="backup-restore-heading" className="shrink-0 text-lg font-semibold">編集用バックアップを復元</h2>
      <div data-notebook-restore-scroll className="min-h-0 overflow-y-auto overscroll-contain [overflow-wrap:anywhere]">
        <p className="mt-4 break-words">{backup.name}</p>
        <p className="mt-2 text-sm">ノート{backup.notes.length}件・フォルダ{backup.folders.length}件</p>
        <p className="mt-3 text-sm">{skipDuplicates
          ? "同じPDF・書き込みのノートは追加しません。内容が違う場合はコピーを追加し、既存のノートは上書きしません。"
          : "一覧の一番上へコピーを追加します。既存のノートは上書きしません。"}</p>
        {error && <p role="alert" className="mt-3 text-error">{error}</p>}
        {busy && <p role="status" className="mt-3 text-sm">復元中…</p>}
      </div>
      <div className="modal-action mt-4 shrink-0 flex-wrap">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>キャンセル</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>復元</button>
      </div>
    </form>
    <div className="modal-backdrop"><button type="button" disabled={busy} onClick={onClose}
      aria-label="復元をキャンセル" tabIndex={-1} /></div>
  </dialog>;
}
