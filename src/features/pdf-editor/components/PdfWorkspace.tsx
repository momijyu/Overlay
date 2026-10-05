"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

import { exportAnnotatedPdf } from "../exportAnnotatedPdf";
import { DEFAULT_PEN_WIDTH } from "../penStyle";
import { saveNote } from "../saveNote";
import type { PenStroke } from "../types";
import { PdfPage } from "./PdfPage";

export function PdfWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [strokesByPage, setStrokesByPage] = useState<Record<number, PenStroke[]>>(
    {},
  );
  const [penWidth, setPenWidth] = useState(DEFAULT_PEN_WIDTH);
  const [zoom, setZoom] = useState(1);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [savedStrokes, setSavedStrokes] = useState<Record<number, PenStroke[]> | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const selectedFile = file;
    if (!selectedFile) return;

    let active = true;
    let loadingTask: PDFDocumentLoadingTask | undefined;

    async function loadPdf(selectedFile: File) {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
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
    setStrokesByPage({});
    setZoom(1);
    setNoteId(null);
    setSavedStrokes(null);
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

  async function handleSave() {
    if (!file || !document || isSaving) return;

    setIsSaving(true);
    setError(null);
    const snapshot = strokesByPage;

    try {
      const savedNoteId = await saveNote({ file, strokesByPage: snapshot, noteId });
      setNoteId(savedNoteId);
      // 保存中に線が追加されても、その新しい線まで保存済みと表示しない。
      setSavedStrokes(snapshot);
    } catch (saveError) {
      console.error("ノートの保存に失敗しました。", saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "ノートを保存できませんでした。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDownload() {
    if (!file || !document || isExporting) return;

    setIsExporting(true);
    setError(null);

    try {
      const pdfBytes = await exportAnnotatedPdf(file, document, strokesByPage);
      const blob = new Blob([new Uint8Array(pdfBytes)], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${file.name.replace(/\.pdf$/i, "")}-overlay.pdf`;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("PDFを書き出せませんでした。別のPDFでお試しください。");
    } finally {
      setIsExporting(false);
    }
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
            disabled={isExporting || isSaving}
            onChange={handleFileChange}
          />
        </div>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        {isLoading && <p role="status">PDFを読み込んでいます…</p>}
        {isExporting && <p role="status">PDFを書き出しています…</p>}
        {isSaving && <p role="status">ノートを保存しています…</p>}

        {document && file && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <p className="min-w-0 truncate" title={file.name}>
                  {file.name}
                </p>
                <div className="flex items-center gap-2">
                  <label className="label" htmlFor="pen-width">
                    ペンの太さ
                  </label>
                  <select
                    id="pen-width"
                    className="select select-sm w-auto"
                    value={penWidth}
                    onChange={(event) => setPenWidth(Number(event.target.value))}
                  >
                    <option value="1.5">細</option>
                    <option value="2.5">標準</option>
                    <option value="5">太</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="label" htmlFor="pdf-zoom">
                    表示倍率
                  </label>
                  <select
                    id="pdf-zoom"
                    className="select select-sm w-auto"
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                  >
                    <option value="0.5">50%</option>
                    <option value="0.75">75%</option>
                    <option value="1">100%</option>
                    <option value="1.25">125%</option>
                    <option value="1.5">150%</option>
                    <option value="2">200%</option>
                  </select>
                </div>
                <button
                  className="btn"
                  type="button"
                  disabled={isSaving || savedStrokes === strokesByPage}
                  onClick={() => void handleSave()}
                >
                  ノートを保存
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={isExporting}
                  onClick={() => void handleDownload()}
                >
                  PDFをダウンロード
                </button>
              </div>
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
            {!isSaving && (
              <p className="text-sm" role="status">
                {noteId
                  ? savedStrokes === strokesByPage
                    ? "保存済み"
                    : "未保存の変更があります"
                  : "未保存"}
              </p>
            )}
            <PdfPage
              key={pageNumber}
              document={document}
              pageNumber={pageNumber}
              strokes={strokesByPage[pageNumber] ?? []}
              penWidth={penWidth}
              zoom={zoom}
              onStrokeComplete={(stroke) => {
                setStrokesByPage((current) => ({
                  ...current,
                  [pageNumber]: [...(current[pageNumber] ?? []), stroke],
                }));
              }}
            />
          </>
        )}
      </div>
    </section>
  );
}
