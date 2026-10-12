"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import type { PenStroke } from "../types";
import { PenLayer } from "./PenLayer";

type PdfPageProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  strokes: PenStroke[];
  penWidth: number;
  zoom: number;
  disabled: boolean;
  onStrokeComplete: (stroke: PenStroke) => void;
};

export function PdfPage({
  document,
  pageNumber,
  strokes,
  penWidth,
  zoom,
  disabled,
  onStrokeComplete,
}: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [renderedPage, setRenderedPage] = useState<{
    availableWidth: number;
    zoom: number;
    scale: number;
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
          setRenderedPage({ availableWidth, zoom, scale });
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
            <PenLayer
              strokes={strokes}
              penWidth={penWidth}
              pageScale={renderedPage.scale}
              onStrokeComplete={onStrokeComplete}
            />
          )}
      </div>
    </div>
  );
}
