"use client";

import { useEffect, useRef, useState } from "react";
import { parsePdfPageSelection } from "../pdfPageSelection";

export function PdfPageExportDialog({ pageNumber, pageCount, disabled, error, onClose, onConfirm }: {
  pageNumber: number; pageCount: number; disabled: boolean; error: string | null;
  onClose: () => void; onConfirm: (pages: number[]) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [input, setInput] = useState(String(pageNumber));
  const [inputError, setInputError] = useState<string | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  function close() { if (!disabled) onClose(); }
  return <dialog ref={ref} className="modal" aria-labelledby="pdf-page-export-heading"
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="modal-box flex max-h-[calc(100dvh-2rem)] max-w-md flex-col overflow-hidden rounded-box">
      <h3 id="pdf-page-export-heading" className="mb-4 shrink-0 text-lg font-semibold">ページを指定してPDF出力</h3>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        try {
          const selected = parsePdfPageSelection(input, pageCount);
          setInputError(null); onConfirm(selected);
        } catch (cause) {
          setInputError(cause instanceof Error ? cause.message : "ページを確認してください。");
        }
      }}>
        <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain">
          <label className="block" htmlFor="pdf-export-pages">出力するページ（全{pageCount}ページ）</label>
          <input id="pdf-export-pages" className="input w-full min-h-11" type="text" value={input}
            maxLength={60000} disabled={disabled} autoFocus aria-describedby="pdf-export-pages-help"
            aria-invalid={!!inputError} onChange={(event) => { setInput(event.target.value); setInputError(null); }} />
          <p id="pdf-export-pages-help" className="text-sm text-base-content/70">例：1, 3-5。白紙を含む現在のページ番号で指定します。</p>
          <button type="button" className="btn btn-sm min-h-11" disabled={disabled}
            onClick={() => { setInput(String(pageNumber)); setInputError(null); }}>表示中のページ（{pageNumber}）</button>
          {(inputError || error) && <p role="alert" className="text-sm text-error">{inputError || error}</p>}
          {disabled && <p role="status" className="text-sm">PDFを出力中…</p>}
        </div>
        <div className="modal-action mt-4 shrink-0 flex-wrap">
          <button type="button" className="btn min-h-11" disabled={disabled} onClick={close}>キャンセル</button>
          <button type="submit" className="btn btn-primary min-h-11" disabled={disabled}>PDFをダウンロード</button>
        </div>
      </form>
    </div>
    <form method="dialog" className="modal-backdrop" onSubmit={(event) => { event.preventDefault(); close(); }}>
      <button type="submit" aria-label="閉じる" disabled={disabled}>閉じる</button>
    </form>
  </dialog>;
}
