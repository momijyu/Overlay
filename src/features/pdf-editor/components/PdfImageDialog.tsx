"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdfForImage, renderPdfImage, type ImportedPdfImage } from "../pdfImageImport";

export function PdfImageDialog({ file, onClose, onInsert }: {
  file: File; onClose(): void; onInsert(image: ImportedPdfImage): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const request = useMemo(() => ({ pdf, page }), [pdf, page]);
  const [preview, setPreview] = useState<{ request: object; image: ImportedPdfImage; url: string } | null>(null);
  const [failure, setFailure] = useState<{ request: object; message: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const ready = preview?.request === request ? preview : null;
  const error = loadError ?? (failure?.request === request ? failure.message : null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    let loaded: PDFDocumentProxy | undefined;
    void openPdfForImage(file, abort.signal).then((value) => {
      loaded = value;
      if (abort.signal.aborted) { void value.loadingTask.destroy().catch(() => {}); return; }
      setPdf(value);
    }).catch((error) => {
      if (!abort.signal.aborted) setLoadError(error instanceof Error ? error.message : "PDFを読み込めませんでした。");
    });
    return () => { abort.abort(); void loaded?.loadingTask.destroy().catch(() => {}); };
  }, [file]);
  useEffect(() => {
    if (!pdf) return;
    const abort = new AbortController();
    let url: string | undefined;
    void renderPdfImage(pdf, page, abort.signal).then((image) => {
      if (abort.signal.aborted) return;
      url = URL.createObjectURL(image.asset.blob);
      setPreview({ request, image, url });
    }).catch((error) => {
      if (!abort.signal.aborted) setFailure({ request, message: error instanceof Error ? error.message : "このページを表示できませんでした。" });
    });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [pdf, page, request]);

  return <dialog ref={dialog} className="modal" aria-labelledby={heading}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="modal-box flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0">
      <h2 id={heading} className="shrink-0 p-5 font-bold">PDFのページを画像として追加</h2>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-5">
        <p className="break-all text-sm">{file.name}</p>
        {pdf && <div className="my-3 flex items-center justify-center gap-2">
          <button type="button" className="btn min-h-11" aria-label="前のページ" disabled={page === 1} onClick={() => setPage(page - 1)}>‹</button>
          <label className="flex items-center gap-2">ページ
            <input type="number" className="input w-20" aria-label="追加するPDFのページ" min={1} max={pdf.numPages} value={page}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value >= 1 && value <= pdf.numPages) setPage(value);
              }} />
            / {pdf.numPages}
          </label>
          <button type="button" className="btn min-h-11" aria-label="次のページ" disabled={page === pdf.numPages} onClick={() => setPage(page + 1)}>›</button>
        </div>}
        {error ? <p role="alert" className="my-4 text-error">{error}</p>
          : ready ? <svg viewBox={`0 0 ${ready.image.asset.width} ${ready.image.asset.height}`} className="my-3 h-52 w-full bg-base-200" role="img" aria-label={`${page}ページのプレビュー`}>
            <image href={ready.url} width={ready.image.asset.width} height={ready.image.asset.height} />
          </svg> : <p role="status" className="my-4 flex items-center gap-2"><span className="loading loading-spinner loading-sm" aria-hidden="true" />PDFを読み込み中…</p>}
        <p className="my-3 text-sm text-base-content/70">選んだ1ページを画像に変換します。文字の選択・検索はできません。</p>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-base-300 p-4">
        <button type="button" className="btn min-h-11" onClick={onClose}>キャンセル</button>
        <button type="button" className="btn btn-primary min-h-11" disabled={!ready || !!error} onClick={() => {
          if (!ready || error) return;
          try { onInsert(ready.image); } catch (failure) {
            setFailure({ request, message: failure instanceof Error ? failure.message : "画像を追加できませんでした。" });
          }
        }}>追加</button>
      </div>
    </div>
    <form method="dialog" className="modal-backdrop" onSubmit={(event) => { event.preventDefault(); onClose(); }}>
      <button type="submit" aria-label="閉じる">閉じる</button>
    </form>
  </dialog>;
}
