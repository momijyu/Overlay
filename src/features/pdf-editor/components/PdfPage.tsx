"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import type { PenStroke, EditorTool, TextNote } from "../types";
import { PenLayer } from "./PenLayer";
import { TextLayer } from "./TextLayer";

type PdfPageProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  strokes: PenStroke[];
  editVersion: number;
  penWidth: number;
  penColor: string;
  tool: EditorTool;
  texts?: TextNote[];
  onTextsChange: (notes: TextNote[]) => void;
  eraserWidth: number;
  zoom: number;
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
  onTextsChange,
  eraserWidth,
  zoom,
  disabled,
  onStrokeComplete,
  onStrokesChange,
}: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [renderedPage, setRenderedPage] = useState<{
    availableWidth: number;
    zoom: number;
    scale: number;
    width: number;
    height: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        renderTask = page.render({
          canvas,
          viewport,
          transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        await renderTask.promise;
        if (active) {
          setError(null);
          setRenderedPage({ availableWidth, zoom, scale, width: original.width, height: original.height });
        }
      } catch {
        if (active) setError("このページを表示できませんでした。");
      }
    }

    void renderPage();

    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [document, pageNumber, availableWidth, zoom]);

  return (
    <div
      ref={containerRef}
      className="min-w-0 w-full overflow-auto bg-base-200 p-2 sm:p-4"
    >
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="relative mx-auto w-fit">
        <canvas
          key={`${pageNumber}-${availableWidth}-${zoom}`}
          ref={canvasRef}
          className="block bg-white shadow-sm"
          aria-label={`PDFの${pageNumber}ページ目`}
          role="img"
        />
        {renderedPage?.availableWidth === availableWidth &&
          renderedPage.zoom === zoom &&
          !disabled &&
          !error && (
            <>
              <PenLayer
              key={`${editVersion}-${tool}-${penWidth}-${penColor}-${eraserWidth}-${renderedPage.scale}`}
              strokes={strokes}
              penWidth={penWidth}
              penColor={penColor}
              tool={tool === "eraser" ? "eraser" : tool === "marker" ? "marker" : "pen"}
              interactive={tool === "pen" || tool === "marker" || tool === "eraser"}
              eraserWidth={eraserWidth}
              pageScale={renderedPage.scale}
              onStrokeComplete={onStrokeComplete}
              onStrokesChange={onStrokesChange}
            />
            </>
          )}
        {/* 倍率・幅の再描画中も入力欄をアンマウントせず、入力中の文章を維持する。 */}
        {renderedPage && (texts.length > 0 || tool === "text" || tool === "sticky") && <TextLayer notes={texts} tool={tool}
          disabled={disabled || !!error || renderedPage.availableWidth !== availableWidth || renderedPage.zoom !== zoom}
          pageWidth={renderedPage.width} pageHeight={renderedPage.height} pageScale={renderedPage.scale}
          onChange={onTextsChange} />}
      </div>
    </div>
  );
}
