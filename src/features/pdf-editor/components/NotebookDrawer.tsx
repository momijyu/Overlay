"use client";

import { useEffect, useRef, useState, type ReactNode, type ChangeEventHandler } from "react";
import { GoogleDriveSetupDialog } from "./GoogleDriveSetup";
import type { NoteBackup } from "../noteBackupData";

type NotebookDrawerProps = {
  open: boolean;
  busy: boolean;
  onFileChange: ChangeEventHandler<HTMLInputElement>;
  onBackupFileChange?: ChangeEventHandler<HTMLInputElement>;
  pdfOpenDisabled: boolean;
  onClose: () => void;
  onImportDriveNote?: (backup: NoteBackup) => void;
  storageControls?: ReactNode;
  loadingMessage?: string | null;
  children: ReactNode;
};

export function NotebookDrawer({ open, busy, onFileChange, onBackupFileChange, pdfOpenDisabled, onClose, children,
  onImportDriveNote, storageControls, loadingMessage }: NotebookDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const backupMenuRef = useRef<HTMLDetailsElement>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const menu = backupMenuRef.current;
    if (!open || pdfOpenDisabled) {
      if (menu) menu.open = false;
    }
    if (!open) return;
    function outside(event: Event) {
      const current = backupMenuRef.current;
      if (current?.open && !current.contains(event.target as Node)) current.open = false;
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, pdfOpenDisabled]);

  return (
    <>
      {/* 通常レイアウトの幅を使わず、PDFの上に重ねる。フォーカス制御はdialogへ任せる。 */}
      <dialog id="notebook-sidebar" ref={dialogRef} className="modal modal-start notebook-modal" aria-label="ノート一覧"
        onCancel={(event) => {
          // 子の名前変更・削除ダイアログのEscapeで一覧まで閉じない。
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          if (!busy) onClose();
        }}
        onClose={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="notebook-drawer modal-box flex h-dvh max-h-none w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-none p-0 motion-reduce:transition-none">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-base-300 px-4 py-3">
            {/* モーダル内の選択欄を使い、編集中のPDFは選択に成功するまで維持する。 */}
            <button type="button" className="btn btn-sm" disabled={pdfOpenDisabled}
              onClick={() => { if (!pdfOpenDisabled) fileInputRef.current?.click(); }}>PDFを開く</button>
            <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" hidden
              aria-label="開くPDFファイル" disabled={pdfOpenDisabled} onChange={onFileChange} />
            <button type="button" className="btn btn-sm btn-square btn-ghost" aria-label="ノート一覧を閉じる"
              disabled={busy} onClick={onClose}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          {loadingMessage && <div role="status" className="flex shrink-0 items-center gap-2 border-b border-base-300 bg-base-200 px-4 py-3 text-sm">
            <span aria-hidden="true" className="loading loading-spinner loading-sm" />
            {loadingMessage}
          </div>}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-notebook-scroll>
          {children}
          {storageControls}
          {onBackupFileChange && <div className="mx-4 border-t border-base-300 py-3">
            <details ref={backupMenuRef} className="w-full" onKeyDown={(event) => {
              if (event.key !== "Escape" || !backupMenuRef.current?.open) return;
              event.preventDefault(); event.stopPropagation();
              backupMenuRef.current.open = false;
              backupMenuRef.current.querySelector("summary")?.focus();
            }}>
              <summary className="btn btn-sm h-auto min-h-11 whitespace-normal text-left" aria-disabled={pdfOpenDisabled}
                onClick={(event) => { if (pdfOpenDisabled) event.preventDefault(); }}>編集用バックアップを読み込む</summary>
              <ul className="menu mt-2 w-full rounded-box border border-base-300 bg-base-100 p-2">
                <li><button type="button" disabled={pdfOpenDisabled} onClick={() => {
                  if (pdfOpenDisabled) return;
                  if (backupMenuRef.current) backupMenuRef.current.open = false;
                  backupInputRef.current?.click();
                }}>ファイルから読み込む</button></li>
                {onImportDriveNote && <li><button type="button" disabled={pdfOpenDisabled} onClick={() => {
                  if (pdfOpenDisabled) return;
                  if (backupMenuRef.current) backupMenuRef.current.open = false;
                  setRestoreOpen(true);
                }}>Driveの手動バックアップから復元</button></li>}
              </ul>
            </details>
            <input ref={backupInputRef} type="file" accept=".overlay,.zip" hidden
              aria-label="読み込むOverlayバックアップ" disabled={pdfOpenDisabled} onChange={onBackupFileChange} />
          </div>}
          </div>
        </div>
        <div className="modal-backdrop">
          <button type="button" aria-label="ノート一覧の外側を押して閉じる" tabIndex={-1}
            disabled={busy} onClick={onClose} />
        </div>
      </dialog>
      {open && restoreOpen && onImportDriveNote && <GoogleDriveSetupDialog
        restore={{ onImportNote: onImportDriveNote }} onClose={() => setRestoreOpen(false)} />}
    </>
  );
}
