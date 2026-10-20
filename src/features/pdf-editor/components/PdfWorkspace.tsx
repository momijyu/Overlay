"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

import { exportAnnotatedPdf } from "../exportAnnotatedPdf";
import { pdfDownloadName } from "../pdfDownloadName";
import { DEFAULT_ERASER_WIDTH, DEFAULT_PEN_WIDTH, isPenColor, PEN_COLOR } from "../penStyle";
import { deleteSavedNote, loadLocalNote as loadSavedNote, saveLocalNote as saveNote } from "../localNotes";
import { attachLocalAutosaveLifecycle, createLocalAutosave, type LocalAutosave } from "../localAutosave";
import type { PenStroke, PenTool } from "../types";
import { PdfPage } from "./PdfPage";
import { NotebookSidebar } from "./NotebookSidebar";
import { EraserSizeControl } from "./EraserSizeControl";
import { PenWidthControl } from "./PenWidthControl";
import { HistoryControls } from "./HistoryControls";
import { createStrokeHistory, recordStrokeEdit, undoStrokeEdit, redoStrokeEdit, type StrokeHistory } from "../strokeHistory";

type PdfInput = {
  file: File;
  id: string | null;
  name?: string;
  strokesByPage: Record<number, PenStroke[]>;
  revision?: number;
};

export function PdfWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [history, setHistory] = useState(() => createStrokeHistory({}));
  const strokesByPage = history.strokesByPage;
  const [penWidth, setPenWidth] = useState(DEFAULT_PEN_WIDTH);
  const [penColor, setPenColor] = useState(PEN_COLOR);
  const [penTool, setPenTool] = useState<PenTool>("pen");
  const [eraserWidth, setEraserWidth] = useState(DEFAULT_ERASER_WIDTH);
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [documentVersion, setDocumentVersion] = useState(0);
  const mountedRef = useRef(false);
  const operationRef = useRef(false);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const autosaveRef = useRef<LocalAutosave | null>(null);
  const historyRef = useRef(history);
  // 自動保存中も描画・ページ切り替え・PDF出力を止めない。
  // ノートを開き直すときだけ、openPdfで保存完了を待つ。
  const isBusy = isLoading || isExporting || isOrganizing;
  const hasUnsavedChanges = file !== null && savedStrokes !== strokesByPage;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      autosaveRef.current?.dispose();
      void loadingTaskRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    // 切り替えた後、前のPDFのワーカーとメモリを解放する。
    return () => {
      void document?.loadingTask.destroy();
    };
  }, [document]);

  useEffect(() => attachLocalAutosaveLifecycle(window, window.document, () => autosaveRef.current), []);

  async function openPdf(getInput: () => Promise<PdfInput>) {
    if (operationRef.current) return;
    operationRef.current = true;
    setIsLoading(true);
    setError(null);
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let isReadingPdf = false;
    try {
      // 通常は保存完了を待ってから切り替える。失敗時だけ破棄の確認をする。
      const previousAutosave = autosaveRef.current;
      if (previousAutosave && !await previousAutosave.flush()
        && !window.confirm("保存できていない変更があります。変更を破棄して別のノートを開きますか？")) return;
      if (!mountedRef.current) return;
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
      previousAutosave?.dispose();
      const nextHistory = createStrokeHistory(input.strokesByPage);
      historyRef.current = nextHistory;
      setFile(input.file);
      setDocument(loadedDocument);
      setHistory(nextHistory);
      setSavedStrokes(input.strokesByPage);
      setNoteId(input.id);
      setNoteName(input.name ?? (input.file.name.replace(/\.pdf$/i, "") || input.file.name));
      setPageNumber(1);
      setZoom(1);
      setPenTool("pen");
      setSaveError(null);
      setIsSaving(false);
      setDocumentVersion((value) => value + 1);
      const autosave = createLocalAutosave({
        file: input.file, noteId: input.id, strokesByPage: input.strokesByPage,
        revision: input.revision, persist: saveNote,
        onChange: (state) => {
          // 古いノートの保存結果が、新しく開いた画面に混ざらないようにする。
          if (!mountedRef.current || autosaveRef.current !== autosave) return;
          setNoteId(state.noteId);
          setSavedStrokes(state.savedStrokes);
          setIsSaving(state.status === "saving");
          setSaveError(state.error);
          if (state.status === "saved") setRefreshVersion((value) => value + 1);
        },
      });
      autosaveRef.current = autosave;
      // 開いただけのPDFは未変更。最初の描画完了でupdateから保存を開始する。
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

  async function handleRetrySave() {
    if (!autosaveRef.current || operationRef.current) return;
    await autosaveRef.current.flush(true);
  }

  function updatePageStrokes(strokes: PenStroke[]) {
    if (operationRef.current) return;
    applyHistory(recordStrokeEdit(historyRef.current, pageNumber, strokes));
  }

  function applyHistory(next: StrokeHistory, revealPage = false) {
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistory(next);
    if (revealPage && next.changedPage !== null) setPageNumber(next.changedPage);
    // Undo / Redoも通常の編集として保存係へ渡し、保存中の古い結果で上書きしない。
    autosaveRef.current?.update(next.strokesByPage);
  }

  function handleUndo() {
    if (operationRef.current || !autosaveRef.current) return;
    applyHistory(undoStrokeEdit(historyRef.current), true);
  }

  function handleRedo() {
    if (operationRef.current || !autosaveRef.current) return;
    applyHistory(redoStrokeEdit(historyRef.current), true);
  }

  async function handleDelete(noteToDelete: string) {
    const autosave = autosaveRef.current;
    const deletingCurrent = autosave?.getState().noteId === noteToDelete;
    // サイドバーが編集をロックしている間に、開始済みの保存を完了させる。
    // 保存失敗時も削除は可能だが、削除自体の失敗時は画面と保存係を残す。
    if (deletingCurrent) await autosave.flush();
    await deleteSavedNote(noteToDelete);
    if (!deletingCurrent) return;
    autosave.dispose();
    autosaveRef.current = null;
    if (!mountedRef.current) return;
    const nextHistory = createStrokeHistory({});
    historyRef.current = nextHistory;
    setFile(null);
    setDocument(null);
    setHistory(nextHistory);
    setSavedStrokes(null);
    setNoteId(null);
    setNoteName("");
    setPageNumber(1);
    setZoom(1);
    setIsSaving(false);
    setSaveError(null);
    setError(null);
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
      link.download = pdfDownloadName(noteName);
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
            onDelete={handleDelete}
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

            <p className="text-sm text-base-content/70">
              重要なノートは定期的に『PDFをダウンロード』して保管してください。
            </p>

            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            {saveError && <div className="alert alert-error" role="alert">
              <span>自動保存に失敗しました。{saveError}</span>
              <button className="btn btn-sm" type="button" disabled={isBusy || isSaving}
                onClick={() => void handleRetrySave()}>保存を再試行</button>
            </div>}

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
                    <div className="join" role="group" aria-label="編集ツール">
                      <button type="button" className={`btn btn-sm join-item ${penTool === "pen" ? "btn-active" : ""}`}
                        aria-pressed={penTool === "pen"} disabled={isBusy} onClick={() => setPenTool("pen")}>ペン</button>
                      <button type="button" className={`btn btn-sm join-item ${penTool === "eraser" ? "btn-active" : ""}`}
                        aria-pressed={penTool === "eraser"} disabled={isBusy} onClick={() => setPenTool("eraser")}>消しゴム</button>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="label" htmlFor="pen-color">ペンの色</label>
                      <input id="pen-color" type="color" className="input input-sm w-14 p-1" value={penColor}
                        disabled={isBusy || penTool !== "pen"} onChange={(event) => {
                          if (isPenColor(event.target.value)) setPenColor(event.target.value);
                        }} />
                    </div>
                    {penTool === "pen" ? <PenWidthControl value={penWidth}
                      disabled={isBusy} onChange={setPenWidth} /> : <EraserSizeControl
                      value={eraserWidth} disabled={isBusy} onChange={setEraserWidth}
                    />}
                    <HistoryControls canUndo={history.past.length > 0} canRedo={history.future.length > 0}
                      disabled={isBusy} onUndo={handleUndo} onRedo={handleRedo} />
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
                    {saveError ? "未保存の変更があります" : noteId
                      ? savedStrokes === strokesByPage
                        ? "このブラウザに保存済み"
                        : "未保存の変更があります"
                      : hasUnsavedChanges ? "未保存の変更があります" : "未編集（書き込みを始めると自動保存）"}
                  </p>
                )}
                {penTool === "eraser" && <p className="text-sm" role="status">
                  書き込みの触れた部分を消します。元PDFは消えません。指やペンを離すと自動保存します。
                </p>}
                <PdfPage
                  key={`${documentVersion}-${pageNumber}`}
                  document={document}
                  pageNumber={pageNumber}
                  strokes={strokesByPage[pageNumber] ?? []}
                  editVersion={history.version}
                  penWidth={penWidth}
                  penColor={penColor}
                  tool={penTool}
                  eraserWidth={eraserWidth}
                  zoom={zoom}
                  disabled={isBusy}
                  onStrokeComplete={(stroke) => {
                    updatePageStrokes([...(historyRef.current.strokesByPage[pageNumber] ?? []), stroke]);
                  }}
                  onStrokesChange={updatePageStrokes}
                />
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
