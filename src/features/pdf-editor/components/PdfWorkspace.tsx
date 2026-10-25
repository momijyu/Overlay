"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { AppHeader } from "@/components/layout/AppHeader";

import { exportAnnotatedPdf } from "../exportAnnotatedPdf";
import { pdfDownloadName } from "../pdfDownloadName";
import { DEFAULT_ERASER_WIDTH, DEFAULT_MARKER_WIDTH, DEFAULT_PEN_WIDTH, isPenColor, MARKER_COLOR, PEN_COLOR } from "../penStyle";
import { deleteSavedNote, deleteSavedItems, loadLocalNote as loadSavedNote, saveLocalNote as saveNote } from "../localNotes";
import type { NoteDragItem } from "../noteDrag";
import { attachLocalAutosaveLifecycle, createLocalAutosave, type LocalAutosave } from "../localAutosave";
import type { PenStroke, EditorTool, TextNote, TextNotesByPage } from "../types";
import { PdfPage } from "./PdfPage";
import { NotebookSidebar } from "./NotebookSidebar";
import { NotebookDrawer } from "./NotebookDrawer";
import { EraserSizeControl } from "./EraserSizeControl";
import { PenWidthControl } from "./PenWidthControl";
import { HistoryControls } from "./HistoryControls";
import { ZoomControl } from "./ZoomControl";
import { EditorIcon } from "./EditorIcon";
import { createStrokeHistory, recordStrokeEdit, recordTextEdit, undoStrokeEdit, redoStrokeEdit, type StrokeHistory } from "../strokeHistory";

type PdfInput = {
  file: File;
  id: string | null;
  name?: string;
  strokesByPage: Record<number, PenStroke[]>;
  textsByPage?: TextNotesByPage;
  revision?: number;
};

const editorTools: { tool: EditorTool; label: string }[] = [
  { tool: "pen", label: "ペン" },
  { tool: "marker", label: "マーカー" },
  { tool: "eraser", label: "消しゴム" },
  { tool: "text", label: "テキスト" },
  { tool: "sticky", label: "付箋" },
  { tool: "hand", label: "移動・閲覧" },
];

export function PdfWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [history, setHistory] = useState(() => createStrokeHistory({}));
  const strokesByPage = history.strokesByPage;
  const [penWidth, setPenWidth] = useState(DEFAULT_PEN_WIDTH);
  const [penColor, setPenColor] = useState(PEN_COLOR);
  const [penTool, setPenTool] = useState<EditorTool>("pen");
  const [eraserWidth, setEraserWidth] = useState(DEFAULT_ERASER_WIDTH);
  const [zoom, setZoom] = useState(1);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteName, setNoteName] = useState("");
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [markerWidth, setMarkerWidth] = useState(DEFAULT_MARKER_WIDTH);
  const [markerColor, setMarkerColor] = useState(MARKER_COLOR);
  const [textControlsContainer, setTextControlsContainer] = useState<HTMLDivElement | null>(null);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const mountedRef = useRef(false);
  const operationRef = useRef(false);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const autosaveRef = useRef<LocalAutosave | null>(null);
  const historyRef = useRef(history);
  // 自動保存中も描画・ページ切り替え・PDF出力を止めない。
  // ノートを開き直すときだけ、openPdfで保存完了を待つ。
  const isBusy = isLoading || isExporting || isOrganizing;

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
        [...Object.keys(input.strokesByPage), ...Object.keys(input.textsByPage ?? {})].some(
          (page) => Number(page) > loadedDocument.numPages,
        )
      ) {
        throw new Error("書き込み情報のページ数がPDFと一致しません。");
      }

      // PDFと線を両方読み込めてから切り替え、失敗時は編集中の内容を残す。
      previousAutosave?.dispose();
      const nextHistory = createStrokeHistory(input.strokesByPage, input.textsByPage);
      historyRef.current = nextHistory;
      setFile(input.file);
      setDocument(loadedDocument);
      setHistory(nextHistory);
      setNoteId(input.id);
      setNoteName(input.name ?? (input.file.name.replace(/\.pdf$/i, "") || input.file.name));
      setPageNumber(1);
      setZoom(1);
      setPenTool("pen");
      setSaveError(null);
      setIsSaving(false);
      setDocumentVersion((value) => value + 1);
      const autosave = createLocalAutosave({
        file: input.file, noteId: input.id, strokesByPage: input.strokesByPage, textsByPage: nextHistory.textsByPage,
        revision: input.revision, persist: saveNote,
        onChange: (state) => {
          // 古いノートの保存結果が、新しく開いた画面に混ざらないようにする。
          if (!mountedRef.current || autosaveRef.current !== autosave) return;
          setNoteId(state.noteId);
          setIsSaving(state.status === "saving");
          setSaveError(state.error);
          if (state.status === "saved") setRefreshVersion((value) => value + 1);
        },
      });
      autosaveRef.current = autosave;
      setSidebarVisible(false);
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

  function updatePageTexts(notes: TextNote[]) {
    if (operationRef.current) return;
    applyHistory(recordTextEdit(historyRef.current, pageNumber, notes));
  }

  function applyHistory(next: StrokeHistory, revealPage = false) {
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistory(next);
    if (revealPage && next.changedPage !== null) setPageNumber(next.changedPage);
    // Undo / Redoも通常の編集として保存係へ渡し、保存中の古い結果で上書きしない。
    autosaveRef.current?.update(next.strokesByPage, next.textsByPage);
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
    await completeDeletion([noteToDelete], () => deleteSavedNote(noteToDelete));
  }

  async function handleDeleteItems(items: NoteDragItem[]) {
    await completeDeletion(items.filter((item) => item.kind === "note").map((item) => item.id), () => deleteSavedItems(items));
  }

  async function completeDeletion(noteIds: string[], remove: () => Promise<void>) {
    const autosave = autosaveRef.current;
    const currentId = autosave?.getState().noteId;
    const deletingCurrent = !!currentId && noteIds.includes(currentId);
    // サイドバーが編集をロックしている間に、開始済みの保存を完了させる。
    // 保存失敗時も削除は可能だが、削除自体の失敗時は画面と保存係を残す。
    if (deletingCurrent && autosave) await autosave.flush();
    await remove();
    if (!deletingCurrent || !autosave) return;
    autosave.dispose();
    autosaveRef.current = null;
    if (!mountedRef.current) return;
    const nextHistory = createStrokeHistory({});
    historyRef.current = nextHistory;
    setFile(null);
    setDocument(null);
    setHistory(nextHistory);
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
      const pdfBytes = await exportAnnotatedPdf(file, document, strokesByPage, history.textsByPage);
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
    } catch (exportError) {
      if (mountedRef.current) {
        setError(exportError instanceof Error ? `PDFを書き出せませんでした。${exportError.message}` : "PDFを書き出せませんでした。");
      }
    } finally {
      operationRef.current = false;
      if (mountedRef.current) setIsExporting(false);
    }
  }

  const statusText = isExporting ? "出力中…" : saveError ? "保存失敗" : isSaving ? "保存中…" : "";
  const backupNotice = <p className="text-sm text-red-400" data-pdf-backup-notice>
    ※ 重要なノートは定期的に『PDFをダウンロード』して保管してください。
  </p>;

  return (
    <div className="overlay-app min-h-screen bg-base-200" data-pdf-open={!!document && !!file}>
      <AppHeader compact={!!document && !!file}>
        <button type="button" className="notebook-toggle btn btn-sm btn-square" aria-label="ノート一覧を開く"
          title="ノート一覧" aria-haspopup="dialog" aria-controls="notebook-sidebar"
          aria-expanded={sidebarVisible} onClick={() => setSidebarVisible(true)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {document && file && <>
          <div className="editor-mobile-heading mobile-only min-w-0 flex-1">
            <p className="truncate text-sm" title={noteName || file.name}>{noteName}</p>
            <p data-editor-mobile-status role="status" className={`min-h-4 text-xs ${saveError ? "text-error" : "text-base-content/60"}`}>{statusText}</p>
          </div>
          <button type="button" className="editor-settings-toggle btn btn-square btn-ghost mobile-only" aria-label="道具の設定"
            title="道具の設定" aria-expanded={mobileSettingsOpen} aria-controls="editor-settings"
            onClick={() => setMobileSettingsOpen((open) => !open)}><EditorIcon name="settings" /></button>
          <details className="editor-export dropdown dropdown-end mobile-only">
            <summary className="btn btn-square btn-ghost" aria-label="書き出しメニュー" title="書き出しメニュー"><EditorIcon name="more" /></summary>
            <div className="dropdown-content z-20 mt-2 w-72 max-w-[calc(100vw-1rem)] rounded-box border border-base-300 bg-base-100 p-3 shadow-sm">
              <button type="button" className="btn w-full" disabled={isBusy} onClick={() => void handleDownload()}>PDFをダウンロード</button>
              <div className="mt-3">{backupNotice}</div>
            </div>
          </details>
        </>}
      </AppHeader>
      <NotebookDrawer open={sidebarVisible} busy={isOrganizing}
        onFileChange={handleFileChange} pdfOpenDisabled={isBusy} onClose={() => setSidebarVisible(false)}>
          {error && <p role="alert" className="px-4 pt-3 text-error">{error}</p>}
          {isLoading && <p role="status" className="px-4 pt-3">PDFを読み込んでいます…</p>}
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
            onDeleteItems={handleDeleteItems}
            onMutationChange={(busy) => {
              operationRef.current = busy;
              setIsOrganizing(busy);
            }}
          />
      </NotebookDrawer>
      <main className="editor-main mx-auto w-full max-w-6xl p-4 sm:p-6">
        <section className="workspace-card card min-w-0 w-full border border-base-300 bg-base-100 shadow-sm">
          <div className="workspace-body card-body gap-5">
            <div hidden={!!document && !!file} data-pdf-upload>
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

            {(!document || !file) && backupNotice}

            {(error || saveError || isLoading) && <div className="editor-notices flex flex-col gap-5">
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
            </div>}

            {document && file && (
              <>
                <div className="editor-toolbar min-w-0 space-y-3">
                  <div data-editor-row="title" className="desktop-only flex h-6 min-w-0 items-center gap-3">
                    <p className="min-w-0 flex-1 truncate" title={noteName || file.name}>
                      {noteName}
                    </p>
                    <span data-editor-row="status" role="status"
                      className={`w-20 shrink-0 whitespace-nowrap text-right text-xs ${saveError ? "text-error" : "text-base-content/60"}`}>
                      {statusText}
                    </span>
                  </div>
                  {/* 道具の列は設定やノート名と分け、切り替えても折り返さない。 */}
                  <div data-editor-row="tools" role="group" aria-label="編集操作"
                    className="editor-tools flex h-14 min-w-0 items-center gap-3 overflow-x-auto whitespace-nowrap [&>*]:shrink-0">
                    <div className="editor-tool-buttons join" role="group" aria-label="編集ツール">
                      {editorTools.map(({ tool, label }) => <button key={tool} type="button"
                        className={`btn btn-square btn-ghost join-item ${penTool === tool ? "bg-base-300 ring-1 ring-inset ring-base-content/30" : ""}`}
                        aria-label={label} title={label} aria-pressed={penTool === tool} disabled={isBusy}
                        onClick={() => { if (!isBusy) { setPenTool(tool); if (tool === "text" || tool === "sticky") setMobileSettingsOpen(true); } }}>
                        <EditorIcon name={tool} />
                      </button>)}
                    </div>
                    <div className="editor-history flex">
                      <HistoryControls canUndo={history.past.length > 0} canRedo={history.future.length > 0}
                        disabled={isBusy} onUndo={handleUndo} onRedo={handleRedo} />
                    </div>
                    <ZoomControl value={zoom} disabled={isBusy} onChange={setZoom} />
                  </div>
                  {/* 高さは維持し、テキスト・付箋の操作もこの行へ表示する。 */}
                  <div data-editor-row="settings" role="group" aria-label="道具の設定"
                    id="editor-settings" data-mobile-open={mobileSettingsOpen}
                    className="editor-settings flex h-14 min-w-0 items-center gap-3 overflow-x-auto whitespace-nowrap [&>*]:shrink-0">
                    {/* マーカーの表示の挙動めっちゃすき。 */}
                    {(penTool === "pen" || penTool === "marker") && <div className="flex items-center gap-2">
                      <label className="label" htmlFor="pen-color">{penTool === "marker" ? "マーカーの色" : "ペンの色"}</label>
                      <input id="pen-color" type="color" className="input input-sm w-14 p-1" value={penTool === "marker" ? markerColor : penColor}
                        disabled={isBusy} onChange={(event) => {
                          if (isPenColor(event.target.value)) {
                            if (penTool === "marker") setMarkerColor(event.target.value);
                            else setPenColor(event.target.value);
                          }
                        }} />
                    </div>}
                    {penTool === "pen" && <PenWidthControl value={penWidth}
                      disabled={isBusy} onChange={setPenWidth} />}
                    {penTool === "marker" && <PenWidthControl tool="marker" value={markerWidth}
                      disabled={isBusy} onChange={setMarkerWidth} />}
                    {penTool === "eraser" && <EraserSizeControl
                      value={eraserWidth} disabled={isBusy} onChange={setEraserWidth}
                    />}
                    {(penTool === "text" || penTool === "sticky") && <div
                      ref={setTextControlsContainer} data-text-controls
                      className="flex items-center gap-2" />}
                    <div className="mobile-zoom mobile-only"><ZoomControl id="mobile-pdf-zoom" value={zoom} disabled={isBusy} onChange={setZoom} /></div>
                  </div>
                  <div data-editor-row="actions" className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <button
                      className="btn btn-primary desktop-only"
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleDownload()}
                    >
                      PDFをダウンロード
                    </button>
                    <div className="join shrink-0" role="group" aria-label="ページ切り替え">
                      <button
                        className="btn btn-square join-item"
                        type="button"
                        aria-label="前のページ" title="前のページ"
                        disabled={isLoading || pageNumber === 1}
                        onClick={() => { if (!isLoading && pageNumber > 1) setPageNumber((page) => page - 1); }}
                      >
                        <EditorIcon name="previous-page" />
                      </button>
                      <span className="btn join-item pointer-events-none min-w-20 tabular-nums" aria-live="polite">
                        {pageNumber} / {document.numPages}
                      </span>
                      <button
                        className="btn btn-square join-item"
                        type="button"
                        aria-label="次のページ" title="次のページ"
                        disabled={isLoading || pageNumber === document.numPages}
                        onClick={() => { if (!isLoading && pageNumber < document.numPages) setPageNumber((page) => page + 1); }}
                      >
                        <EditorIcon name="next-page" />
                      </button>
                    </div>
                  </div>
                  <div className="desktop-only">{backupNotice}</div>
                </div>
                <PdfPage
                  key={`${documentVersion}-${pageNumber}`}
                  document={document}
                  pageNumber={pageNumber}
                  strokes={strokesByPage[pageNumber] ?? []}
                  texts={history.textsByPage[pageNumber] ?? []}
                  textControlsContainer={textControlsContainer}
                  onTextsChange={updatePageTexts}
                  editVersion={history.version}
                  penWidth={penTool === "marker" ? markerWidth : penWidth}
                  penColor={penTool === "marker" ? markerColor : penColor}
                  tool={penTool}
                  eraserWidth={eraserWidth}
                  zoom={zoom}
                  onZoomChange={setZoom}
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
      </main>
    </div>
  );
}
