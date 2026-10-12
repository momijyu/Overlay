"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

import { exportAnnotatedPdf } from "../exportAnnotatedPdf";
import { DEFAULT_PEN_WIDTH } from "../penStyle";
import { loadSavedNote } from "../loadNotes";
import { saveNote } from "../saveNote";
import type { PenStroke } from "../types";
import { PdfPage } from "./PdfPage";
import { NotebookSidebar } from "./NotebookSidebar";

type PdfInput = {
  file: File;
  id: string | null;
  name?: string;
  strokesByPage: Record<number, PenStroke[]>;
};

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
  const [noteName, setNoteName] = useState("");
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [savedStrokes, setSavedStrokes] = useState<Record<number, PenStroke[]> | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [documentVersion, setDocumentVersion] = useState(0);
  const mountedRef = useRef(false);
  const operationRef = useRef(false);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const isBusy = isLoading || isExporting || isSaving || isOrganizing;
  const hasUnsavedChanges = file !== null && savedStrokes !== strokesByPage;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void loadingTaskRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    // 切り替えた後、前のPDFのワーカーとメモリを解放する。
    return () => {
      void document?.loadingTask.destroy();
    };
  }, [document]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnsavedChanges]);

  async function openPdf(getInput: () => Promise<PdfInput>) {
    if (operationRef.current) return;
    if (
      hasUnsavedChanges &&
      !window.confirm("未保存の内容があります。保存せずに別のノートを開きますか？")
    ) {
      return;
    }

    operationRef.current = true;
    setIsLoading(true);
    setError(null);
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let isReadingPdf = false;
    try {
      const input = await getInput();
      isReadingPdf = true;
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const data = await input.file.arrayBuffer();
      if (!mountedRef.current) return;

      loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
      loadingTaskRef.current = loadingTask;
      const loadedDocument = await loadingTask.promise;
      if (!mountedRef.current) return;
      if (
        Object.keys(input.strokesByPage).some(
          (page) => Number(page) > loadedDocument.numPages,
        )
      ) {
        throw new Error("書き込み情報のページ数がPDFと一致しません。");
      }

      // PDFと線を両方読み込めてから切り替え、失敗時は編集中の内容を残す。
      setFile(input.file);
      setDocument(loadedDocument);
      setStrokesByPage(input.strokesByPage);
      setSavedStrokes(input.id ? input.strokesByPage : null);
      setNoteId(input.id);
      setNoteName(input.name ?? (input.file.name.replace(/\.pdf$/i, "") || input.file.name));
      setPageNumber(1);
      setZoom(1);
      setDocumentVersion((value) => value + 1);
    } catch (openError) {
      void loadingTask?.destroy();
      if (mountedRef.current) {
        setError(
          openError instanceof Error && !isReadingPdf
            ? openError.message
            : "PDFを開けませんでした。元の内容は変更していません。",
        );
      }
    } finally {
      loadingTaskRef.current = null;
      operationRef.current = false;
      if (mountedRef.current) setIsLoading(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";
    if (!selectedFile) return;

    if (
      selectedFile.type !== "application/pdf" &&
      !selectedFile.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("PDFファイルを選択してください。");
      return;
    }

    void openPdf(async () => ({ file: selectedFile, id: null, strokesByPage: {} }));
  }

  async function handleSave() {
    if (!file || !document || operationRef.current) return;

    operationRef.current = true;
    setIsSaving(true);
    setError(null);
    const snapshot = strokesByPage;

    try {
      const savedNoteId = await saveNote({ file, strokesByPage: snapshot, noteId });
      if (!mountedRef.current) return;
      setNoteId(savedNoteId);
      // 保存中に線が追加されても、その新しい線まで保存済みと表示しない。
      setSavedStrokes(snapshot);
      setRefreshVersion((value) => value + 1);
    } catch (saveError) {
      console.error("ノートの保存に失敗しました。", saveError);
      if (mountedRef.current) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "ノートを保存できませんでした。",
        );
      }
    } finally {
      operationRef.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }

  async function handleDownload() {
    if (!file || !document || operationRef.current) return;

    operationRef.current = true;
    setIsExporting(true);
    setError(null);

    try {
      const pdfBytes = await exportAnnotatedPdf(file, document, strokesByPage);
      if (!mountedRef.current) return;
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
      if (mountedRef.current) {
        setError("PDFを書き出せませんでした。別のPDFでお試しください。");
      }
    } finally {
      operationRef.current = false;
      if (mountedRef.current) setIsExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <button type="button" className="btn btn-sm" aria-controls="notebook-sidebar"
          aria-expanded={sidebarVisible} onClick={() => setSidebarVisible((value) => !value)}>
          ノート
        </button>
      </div>
      <div className="flex items-start gap-4">
        <aside id="notebook-sidebar" hidden={!sidebarVisible} className="w-80 shrink-0">
          <NotebookSidebar
            refreshVersion={refreshVersion}
            currentNoteId={noteId}
            disabled={isBusy}
            onOpen={(note) => {
              void openPdf(async () => ({ ...await loadSavedNote(note.id), name: note.title }));
            }}
            onRenamed={(id, title) => {
              if (id === noteId) setNoteName(title);
            }}
            onMutationChange={(busy) => {
              operationRef.current = busy;
              setIsOrganizing(busy);
            }}
          />
        </aside>
        <section className="card min-w-0 flex-1 border border-base-300 bg-base-100 shadow-sm">
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
                disabled={isBusy}
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
                      {noteName}
                    </p>
                    <div className="flex items-center gap-2">
                      <label className="label" htmlFor="pen-width">
                        ペンの太さ
                      </label>
                      <select
                        id="pen-width"
                        className="select select-sm w-auto"
                        value={penWidth}
                        disabled={isLoading}
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
                        disabled={isLoading}
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
                      disabled={isBusy || savedStrokes === strokesByPage}
                      onClick={() => void handleSave()}
                    >
                      ノートを保存
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDownload()}
                    >
                      PDFをダウンロード
                    </button>
                  </div>
                  <div className="join" aria-label="ページ切り替え">
                    <button
                      className="btn join-item"
                      type="button"
                      disabled={isLoading || pageNumber === 1}
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
                      disabled={isLoading || pageNumber === document.numPages}
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
                  key={`${documentVersion}-${pageNumber}`}
                  document={document}
                  pageNumber={pageNumber}
                  strokes={strokesByPage[pageNumber] ?? []}
                  penWidth={penWidth}
                  zoom={zoom}
                  disabled={isLoading}
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
      </div>
    </div>
  );
}
