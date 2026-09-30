"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

import { PdfPage } from "./PdfPage";

export function PdfWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const selectedFile = file;
    if (!selectedFile) return;

    let active = true;
    let loadingTask: PDFDocumentLoadingTask | undefined;

    async function loadPdf(selectedFile: File) {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const data = await selectedFile.arrayBuffer();
        if (!active) return;

        loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
        const loadedDocument = await loadingTask.promise;
        if (!active) return;

        setDocument(loadedDocument);
      } catch {
        if (active) setError("PDFを開けませんでした。別のPDFを選択してください。");
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadPdf(selectedFile);

    return () => {
      active = false;
      void loadingTask?.destroy();
    };
  }, [file]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";
    if (!selectedFile) return;

    setFile(null);
    setDocument(null);
    setPageNumber(1);
    setError(null);

    if (
      selectedFile.type !== "application/pdf" &&
      !selectedFile.name.toLowerCase().endsWith(".pdf")
    ) {
      setIsLoading(false);
      setError("PDFファイルを選択してください。");
      return;
    }

    setIsLoading(true);
    setFile(selectedFile);
  }

  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-5">
        <div>
          <label className="label" htmlFor="pdf-upload">
            PDFファイル
          </label>
          <input
            id="pdf-upload"
            className="file-input w-full max-w-md"
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileChange}
          />
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        {isLoading && <p role="status">PDFを読み込んでいます…</p>}

        {document && file && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 truncate" title={file.name}>
                {file.name}
              </p>
              <div className="join" aria-label="ページ切り替え">
                <button
                  className="btn join-item"
                  type="button"
                  disabled={pageNumber === 1}
                  onClick={() => setPageNumber((page) => page - 1)}
                >
                  前へ
                </button>
                <span className="btn join-item pointer-events-none" aria-live="polite">
                  {pageNumber} / {document.numPages}
                </span>
                <button
                  className="btn join-item"
                  type="button"
                  disabled={pageNumber === document.numPages}
                  onClick={() => setPageNumber((page) => page + 1)}
                >
                  次へ
                </button>
              </div>
            </div>
            <PdfPage document={document} pageNumber={pageNumber} />
          </>
        )}
      </div>
    </section>
  );
}
