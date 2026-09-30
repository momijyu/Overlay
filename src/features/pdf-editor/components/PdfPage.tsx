"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

import type { PenStroke } from "../types";
import { PenLayer } from "./PenLayer";

type PdfPageProps = {
  document: PDFDocumentProxy;
  pageNumber: number;
  strokes: PenStroke[];
  onStrokeComplete: (stroke: PenStroke) => void;
};

export function PdfPage({
  document,
  pageNumber,
  strokes,
  onStrokeComplete,
}: PdfPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [renderedWidth, setRenderedWidth] = useState<number | null>(null);
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
        const scale = Math.min(1, availableWidth / original.width);
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
          setRenderedWidth(availableWidth);
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
  }, [document, pageNumber, availableWidth]);

  return (
    <div ref={containerRef} className="overflow-auto bg-base-200 p-2 sm:p-4">
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="relative mx-auto w-fit">
        <canvas
          key={`${pageNumber}-${availableWidth}`}
          ref={canvasRef}
          className="block bg-white shadow-sm"
          aria-label={`PDFの${pageNumber}ページ目`}
          role="img"
        />
        {renderedWidth === availableWidth && !error && (
          <PenLayer strokes={strokes} onStrokeComplete={onStrokeComplete} />
        )}
      </div>
    </div>
  );
}
