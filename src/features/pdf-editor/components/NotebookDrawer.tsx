"use client";

import { useEffect, useRef, useState, type ReactNode, type ChangeEventHandler } from "react";
import { GoogleDriveSetup, GoogleDriveSetupDialog, type DriveSaveRequest } from "./GoogleDriveSetup";
import type { NoteBackup } from "../noteBackupData";

type NotebookDrawerProps = {
  open: boolean;
  busy: boolean;
  onFileChange: ChangeEventHandler<HTMLInputElement>;
  onBackupFileChange?: ChangeEventHandler<HTMLInputElement>;
  pdfOpenDisabled: boolean;
  onClose: () => void;
  captureDriveNote?: () => NoteBackup;
  onImportDriveNote?: (backup: NoteBackup) => void;
  driveSaveRequest?: DriveSaveRequest | null;
  onDriveSaveRequestClose?: () => void;
  children: ReactNode;
};

export function NotebookDrawer({ open, busy, onFileChange, onBackupFileChange, pdfOpenDisabled, onClose, children,
  captureDriveNote, onImportDriveNote, driveSaveRequest, onDriveSaveRequestClose }: NotebookDrawerProps) {
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

  return (
    <>
      {/* 通常レイアウトの幅を使わず、PDFの上に重ねる。フォーカス制御はdialogへ任せる。 */}
      <dialog id="notebook-sidebar" ref={dialogRef} className="modal modal-start" aria-label="ノート一覧"
        onCancel={(event) => {
          // 子の名前変更・削除ダイアログのEscapeで一覧まで閉じない。
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          if (!busy) onClose();
        }}
        onClose={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="modal-box h-dvh w-80 max-w-[calc(100vw-2rem)] rounded-none p-0 motion-reduce:transition-none">
          <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-3">
            {/* モーダル内の選択欄を使い、編集中のPDFは選択に成功するまで維持する。 */}
            <button type="button" className="btn btn-sm" disabled={pdfOpenDisabled}
              onClick={() => { if (!pdfOpenDisabled) fileInputRef.current?.click(); }}>PDFを追加</button>
            <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" hidden
              aria-label="追加するPDFファイル" disabled={pdfOpenDisabled} onChange={onFileChange} />
            <button type="button" className="btn btn-sm btn-square btn-ghost" aria-label="ノート一覧を閉じる"
              disabled={busy} onClick={onClose}>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          {onBackupFileChange && <div className="px-4 pb-3">
            <details ref={backupMenuRef} className="dropdown w-full">
              <summary className="btn btn-sm" aria-disabled={pdfOpenDisabled}
                onClick={(event) => { if (pdfOpenDisabled) event.preventDefault(); }}>バックアップを読み込む</summary>
              <ul className="dropdown-content menu z-10 mt-2 w-full rounded-box border border-base-300 bg-base-100 p-2 shadow">
                <li><button type="button" disabled={pdfOpenDisabled} onClick={() => {
                  if (pdfOpenDisabled) return;
                  if (backupMenuRef.current) backupMenuRef.current.open = false;
                  backupInputRef.current?.click();
                }}>ファイルから読み込む</button></li>
                {onImportDriveNote && <li><button type="button" disabled={pdfOpenDisabled} onClick={() => {
                  if (pdfOpenDisabled) return;
                  if (backupMenuRef.current) backupMenuRef.current.open = false;
                  setRestoreOpen(true);
                }}>以前のDriveバックアップから</button></li>}
              </ul>
            </details>
            <input ref={backupInputRef} type="file" accept=".overlay,.zip" hidden
              aria-label="読み込むOverlayバックアップ" disabled={pdfOpenDisabled} onChange={onBackupFileChange} />
          </div>}
          {children}
          {open && <GoogleDriveSetup disabled={busy || pdfOpenDisabled} captureNote={captureDriveNote}
            saveRequest={driveSaveRequest} onSaveRequestClose={onDriveSaveRequestClose} />}
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
