"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import type { PenStroke, EditorTool, TextNote } from "../types";
import { PenLayer } from "./PenLayer";
import { TextLayer } from "./TextLayer";
import { bindPageZoomWheel, capturePageZoomAnchor, restorePageZoomAnchor, type PageZoomAnchor } from "../pageZoom";
import { bindPageGestures, createPageInteraction } from "../pageGestures";

type PdfPageProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  strokes: PenStroke[];
  editVersion: number;
  penWidth: number;
  penColor: string;
  tool: EditorTool;
  texts?: TextNote[];
  textControlsContainer?: HTMLDivElement | null;
  onTextsChange: (notes: TextNote[]) => void;
  eraserWidth: number;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  disabled: boolean;
  onStrokeComplete: (stroke: PenStroke) => void;
  onStrokesChange: (strokes: PenStroke[]) => void;
};

export function PdfPage({
  document,
  pageNumber,
  strokes,
  editVersion,
  penWidth,
  penColor,
  tool,
  texts = [],
  textControlsContainer = null,
  onTextsChange,
  eraserWidth,
  zoom,
  onZoomChange,
  disabled,
  onStrokeComplete,
  onStrokesChange,
}: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  const anchorRef = useRef<PageZoomAnchor | null>(null);
  const displaySizeRef = useRef<string | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [renderedPage, setRenderedPage] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interaction] = useState(createPageInteraction);
  const displayScale = renderedPage ? Math.min(1, availableWidth / renderedPage.width) * zoom : 0;

  useLayoutEffect(() => {
    zoomRef.current = zoom;
    const viewport = containerRef.current;
    const surface = surfaceRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !surface || !canvas || !renderedPage || displayScale <= 0) return;
    const size = `${renderedPage.width * displayScale}-${renderedPage.height * displayScale}`;
    if (displaySizeRef.current === size) { anchorRef.current = null; return; }
    // スライダーの場合は表示領域の中心、ホイールの場合はポインター位置を維持する。
    const anchor = displaySizeRef.current ? anchorRef.current ?? capturePageZoomAnchor(viewport, surface) : null;
    canvas.style.width = `${renderedPage.width * displayScale}px`;
    canvas.style.height = `${renderedPage.height * displayScale}px`;
    if (anchor) restorePageZoomAnchor(viewport, surface, anchor);
    anchorRef.current = null;
    displaySizeRef.current = size;
  }, [zoom, displayScale, renderedPage]);

  useEffect(() => {
    const viewport = containerRef.current;
    if (!viewport) return;
    return bindPageZoomWheel(viewport, {
      getZoom: () => zoomRef.current,
      isEnabled: () => !disabled && !error && displaySizeRef.current !== null,
      onZoom: (next, event) => {
        const surface = surfaceRef.current;
        if (!surface) return;
        anchorRef.current = capturePageZoomAnchor(viewport, surface, event);
        zoomRef.current = next; // 同じ描画フレーム内の連続入力も積み重ねる。
        onZoomChange(next);
      },
    });
  }, [disabled, error, onZoomChange]);

  useEffect(() => {
    const viewport = containerRef.current;
    if (!viewport) return;
    return bindPageGestures(viewport, {
      interaction,
      getSurface: () => surfaceRef.current,
      getZoom: () => zoomRef.current,
      isEnabled: () => !disabled && !error && displaySizeRef.current !== null,
      isHand: () => tool === "hand",
      onTransform: (next, anchor) => {
        const changed = next !== zoomRef.current;
        zoomRef.current = next;
        anchorRef.current = anchor;
        if (changed) onZoomChange(next);
        else if (surfaceRef.current) restorePageZoomAnchor(viewport, surfaceRef.current, anchor);
      },
    });
  }, [disabled, error, tool, onZoomChange, interaction]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(container);
      setAvailableWidth(
        container.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
      );
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (availableWidth === 0) return;

    let active = true;
    let renderTask: RenderTask | undefined;

    async function renderPage() {
      try {
        const page = await document.getPage(pageNumber);
        if (!active) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const original = page.getViewport({ scale: 1 });
        // 最初に収まる大きさを100%として、その大きさに表示倍率を掛ける。
        const scale = Math.min(1, availableWidth / original.width) * zoom;
        const viewport = page.getViewport({ scale });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

        // 表示中のビットマップを消さず、別キャンバスで次の倍率を描画する。
        const buffer = canvas.ownerDocument.createElement("canvas");
        buffer.width = Math.ceil(viewport.width * pixelRatio);
        buffer.height = Math.ceil(viewport.height * pixelRatio);

        renderTask = page.render({
          canvas: buffer,
          viewport,
          transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        await renderTask.promise;
        if (active) {
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas is unavailable");
          canvas.width = buffer.width;
          canvas.height = buffer.height;
          context.drawImage(buffer, 0, 0);
          setError(null);
          setRenderedPage({ width: original.width, height: original.height });
        }
      } catch {
        if (active) setError("このページを表示できませんでした。");
      }
    }

    // 操作中は既存画像をCSSで即座に拡縮し、入力が落ち着いてから高精細に描き直す。
    const timer = displaySizeRef.current ? setTimeout(() => void renderPage(), 100) : null;
    if (timer === null) void renderPage();

    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
      renderTask?.cancel();
    };
  }, [document, pageNumber, availableWidth, zoom]);

  return (
    <div
      ref={containerRef}
      className={`pdf-viewport max-h-[75dvh] min-w-0 w-full overflow-auto bg-base-200 p-2 sm:p-4 touch-none ${tool === "hand" ? "cursor-grab" : ""}`}
      style={{ scrollbarGutter: "stable", overflowAnchor: "none" }}
      tabIndex={0}
      aria-label="PDF表示領域"
    >
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div ref={surfaceRef} className="relative mx-auto w-fit">
        <canvas
          ref={canvasRef}
          className="block bg-white shadow-sm"
          aria-label={`PDFの${pageNumber}ページ目`}
          role="img"
        />
        {renderedPage && displayScale > 0 &&
          !error && (
            <PenLayer
              key={`${editVersion}-${tool}-${penWidth}-${penColor}-${eraserWidth}-${displayScale}`}
              strokes={strokes}
              pageWidth={renderedPage.width} pageHeight={renderedPage.height}
              interaction={interaction}
              penWidth={penWidth}
              penColor={penColor}
              tool={tool === "eraser" ? "eraser" : tool === "marker" ? "marker" : "pen"}
              interactive={!disabled && (tool === "pen" || tool === "marker" || tool === "eraser")}
              eraserWidth={eraserWidth}
              pageScale={displayScale}
              onStrokeComplete={onStrokeComplete}
              onStrokesChange={onStrokesChange}
            />
          )}
        {/* 倍率・幅の再描画中も入力欄をアンマウントせず、入力中の文章を維持する。 */}
        {renderedPage && (texts.length > 0 || tool === "text" || tool === "sticky") && <TextLayer notes={texts} tool={tool}
          controlsContainer={textControlsContainer}
          interaction={interaction}
          disabled={disabled || !!error || displayScale <= 0}
          pageWidth={renderedPage.width} pageHeight={renderedPage.height} pageScale={displayScale}
          onChange={onTextsChange} />}
      </div>
    </div>
  );
}
