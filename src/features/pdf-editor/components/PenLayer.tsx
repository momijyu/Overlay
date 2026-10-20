"use client";

import { useRef, useState, type PointerEvent } from "react";

import { PEN_COLOR } from "../penStyle";
import { eraseStrokes } from "../eraseStrokes";
import type { PenPoint, PenStroke, PenTool } from "../types";

type PenLayerProps = {
  strokes: PenStroke[];
  penWidth: number;
  penColor: string;
  tool: PenTool;
  eraserWidth: number;
  pageScale: number;
  interactive?: boolean;
  onStrokeComplete: (stroke: PenStroke) => void;
  onStrokesChange: (strokes: PenStroke[]) => void;
};

function pointFromEvent(event: PointerEvent<SVGSVGElement>, clamp = true): PenPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;
  return clamp ? { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) } : { x, y };
}

function strokePath(stroke: PenStroke): string {
  const [first, ...rest] = stroke.points;
  if (!first) return "";

  // 短い線に丸い端を付け、クリックだけでも点が見えるようにする。
  if (rest.length === 0) return `M ${first.x} ${first.y} l 0.00001 0`;

  return `M ${first.x} ${first.y} ${rest
    .map((point) => `L ${point.x} ${point.y}`)
    .join(" ")}`;
}

export function PenLayer({
  strokes,
  penWidth,
  penColor,
  tool,
  eraserWidth,
  pageScale,
  interactive = true,
  onStrokeComplete,
  onStrokesChange,
}: PenLayerProps) {
  const activePointerId = useRef<number | null>(null);
  const currentStroke = useRef<PenStroke | null>(null);
  const [draft, setDraft] = useState<PenStroke | null>(null);
  const erasedStrokes = useRef<PenStroke[] | null>(null);
  const previousEraserPoint = useRef<PenPoint | null>(null);
  const [erasePreview, setErasePreview] = useState<PenStroke[] | null>(null);
  const [eraserPosition, setEraserPosition] = useState<{ point: PenPoint; width: number; height: number } | null>(null);

  function eraseAt(event: PointerEvent<SVGSVGElement>) {
    if (!erasedStrokes.current || !previousEraserPoint.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const point = pointFromEvent(event, false);
    erasedStrokes.current = eraseStrokes(erasedStrokes.current, previousEraserPoint.current, point,
      bounds.width, bounds.height, eraserWidth * pageScale / 2, pageScale);
    previousEraserPoint.current = point;
    setErasePreview(erasedStrokes.current);
    setEraserPosition({ point, width: bounds.width, height: bounds.height });
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!interactive) return;
    if (activePointerId.current !== null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerId.current = event.pointerId;
    if (tool === "eraser") {
      erasedStrokes.current = strokes;
      previousEraserPoint.current = pointFromEvent(event, false);
      eraseAt(event);
      return;
    }
    currentStroke.current = { points: [pointFromEvent(event)], width: penWidth, color: penColor };
    setDraft(currentStroke.current);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (activePointerId.current === event.pointerId && tool === "eraser") {
      eraseAt(event);
      return;
    }
    if (activePointerId.current !== event.pointerId || !currentStroke.current) {
      return;
    }

    currentStroke.current = {
      ...currentStroke.current,
      points: [...currentStroke.current.points, pointFromEvent(event)],
    };
    setDraft(currentStroke.current);
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    if (activePointerId.current === event.pointerId && tool === "eraser") {
      eraseAt(event);
      const result = erasedStrokes.current;
      handlePointerCancel(event);
      // 操作中の表示だけを更新し、指を離した時に1回だけ保存へ渡す。
      if (result && result !== strokes) onStrokesChange(result);
      return;
    }
    if (activePointerId.current !== event.pointerId || !currentStroke.current) {
      return;
    }

    const completedStroke = {
      ...currentStroke.current,
      points: [...currentStroke.current.points, pointFromEvent(event)],
    };
    activePointerId.current = null;
    currentStroke.current = null;
    setDraft(null);
    onStrokeComplete(completedStroke);
  }

  function handlePointerCancel(event: PointerEvent<SVGSVGElement>) {
    if (activePointerId.current !== event.pointerId) return;

    activePointerId.current = null;
    currentStroke.current = null;
    setDraft(null);
    erasedStrokes.current = null;
    previousEraserPoint.current = null;
    setErasePreview(null);
    setEraserPosition(null);
  }

  return (
    <svg
      className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
      style={{ pointerEvents: interactive ? "auto" : "none" }}
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-label={tool === "eraser" ? "書き込みを部分的に消す領域" : "ペンで書き込む領域"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    >
      <rect width="1" height="1" fill="transparent" pointerEvents={interactive ? "all" : "none"} />
      {[...(erasePreview ?? strokes), ...(draft ? [draft] : [])].map((stroke, index) => (
        <path
          key={index}
          d={strokePath(stroke)}
          fill="none"
          stroke={stroke.color ?? PEN_COLOR}
          strokeWidth={stroke.width * pageScale}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
      {/* ページ縦横比を補正し、表示上では円形の消しゴム範囲を示す。 */}
      {tool === "eraser" && eraserPosition && <ellipse
        cx={eraserPosition.point.x} cy={eraserPosition.point.y}
        rx={eraserWidth * pageScale / 2 / eraserPosition.width}
        ry={eraserWidth * pageScale / 2 / eraserPosition.height}
        fill="none" stroke="#666666" strokeWidth="1" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
    </svg>
  );
}
