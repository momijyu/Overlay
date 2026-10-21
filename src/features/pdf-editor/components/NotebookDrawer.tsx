"use client";

import { useEffect, useRef, type ReactNode, type ChangeEventHandler } from "react";

type NotebookDrawerProps = {
  open: boolean;
  busy: boolean;
  onFileChange: ChangeEventHandler<HTMLInputElement>;
  pdfOpenDisabled: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function NotebookDrawer({ open, busy, onFileChange, pdfOpenDisabled, onClose, children }: NotebookDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          <div className="flex items-center justify-between gap-2 px-4 pt-3">
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
          {children}
        </div>
        <div className="modal-backdrop">
          <button type="button" aria-label="ノート一覧の外側を押して閉じる" tabIndex={-1}
            disabled={busy} onClick={onClose} />
        </div>
      </dialog>
    </>
  );
}
