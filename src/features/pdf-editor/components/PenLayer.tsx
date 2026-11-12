"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { PageInteraction } from "../pageGestures";

import { MARKER_OPACITY, PEN_COLOR } from "../penStyle";
import { eraseStrokes } from "../eraseStrokes";
import { createShapeStroke, type ShapeKind } from "../shapeStrokes";
import { fillEnclosedRegion } from "../fillRegion";
import type { PenPoint, PenStroke, PenTool } from "../types";

type PenLayerProps = {
  strokes: PenStroke[];
  penWidth: number;
  penColor: string;
  tool: PenTool | "shape" | "fill";
  shapeKind?: ShapeKind;
  eraserWidth: number;
  pageScale: number;
  pageWidth: number;
  pageHeight: number;
  interaction?: PageInteraction;
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

function strokePath(stroke: PenStroke, width: number, height: number): string {
  const [first, ...rest] = stroke.points;
  if (!first) return "";

  // 短い線に丸い端を付け、クリックだけでも点が見えるようにする。
  if (rest.length === 0) return `M ${first.x * width} ${first.y * height} l 0.001 0`;

  return `M ${first.x * width} ${first.y * height} ${rest
    .map((point) => `L ${point.x * width} ${point.y * height}`)
    .join(" ")}`;
}

export function PenLayer({
  strokes,
  penWidth,
  penColor,
  tool,
  shapeKind = "rectangle",
  eraserWidth,
  pageScale,
  pageWidth,
  pageHeight,
  interaction,
  interactive = true,
  onStrokeComplete,
  onStrokesChange,
}: PenLayerProps) {
  const activePointerId = useRef<number | null>(null);
  const currentStroke = useRef<PenStroke | null>(null);
  const shapeOrigin = useRef<PenPoint | null>(null);
  const [draft, setDraft] = useState<PenStroke | null>(null);
  const erasedStrokes = useRef<PenStroke[] | null>(null);
  const previousEraserPoint = useRef<PenPoint | null>(null);
  const [erasePreview, setErasePreview] = useState<PenStroke[] | null>(null);
  const [eraserPosition, setEraserPosition] = useState<{ point: PenPoint; width: number; height: number } | null>(null);
  const [fillMessage, setFillMessage] = useState("");

  useEffect(() => {
    const cancel = () => {
      activePointerId.current = null; currentStroke.current = null; setDraft(null);
      shapeOrigin.current = null;
      erasedStrokes.current = null; previousEraserPoint.current = null;
      setErasePreview(null); setEraserPosition(null);
    };
    interaction?.cancellations.add(cancel);
    return () => { interaction?.cancellations.delete(cancel); };
  }, [interaction]);

  function eraseAt(event: PointerEvent<SVGSVGElement>) {
    if (!erasedStrokes.current || !previousEraserPoint.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const point = pointFromEvent(event, false);
    try {
      erasedStrokes.current = eraseStrokes(erasedStrokes.current, previousEraserPoint.current, point,
        bounds.width, bounds.height, eraserWidth * pageScale / 2, pageScale);
    } catch (error) {
      handlePointerCancel(event);
      setFillMessage(error instanceof Error ? error.message : "消去できませんでした。");
      return;
    }
    previousEraserPoint.current = point;
    setErasePreview(erasedStrokes.current);
    setEraserPosition({ point, width: bounds.width, height: bounds.height });
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!interactive || interaction?.blocked) return;
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
    if (tool === "shape" || tool === "fill") {
      shapeOrigin.current = pointFromEvent(event);
      setFillMessage("");
      return;
    }
    currentStroke.current = { points: [pointFromEvent(event)], width: penWidth, color: penColor,
      ...(tool === "marker" ? { kind: "marker" as const } : {}) };
    setDraft(currentStroke.current);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (interaction?.blocked) return;
    if (tool === "fill") return;
    if (activePointerId.current === event.pointerId && tool === "shape" && shapeOrigin.current) {
      setDraft(createShapeStroke(shapeKind, shapeOrigin.current, pointFromEvent(event), pageWidth, pageHeight, penWidth, penColor));
      return;
    }
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
    if (interaction?.blocked) { handlePointerCancel(event); return; }
    if (activePointerId.current === event.pointerId && tool === "fill" && shapeOrigin.current) {
      const origin = shapeOrigin.current, point = pointFromEvent(event);
      handlePointerCancel(event);
      const bounds = event.currentTarget.getBoundingClientRect();
      if (Math.hypot((point.x - origin.x) * bounds.width, (point.y - origin.y) * bounds.height) > 8) return;
      try {
        const result = fillEnclosedRegion(strokes, point, pageWidth, pageHeight, penColor);
        const same = (stroke: PenStroke) => stroke.kind === "fill" && JSON.stringify(stroke.points) === JSON.stringify(result.points);
        const previous = strokes.find(same);
        if (previous?.color === result.color) return;
        if (previous) onStrokesChange([...strokes.filter((stroke) => !same(stroke)), result]);
        else onStrokeComplete(result);
      } catch (error) { setFillMessage(error instanceof Error ? error.message : "塗りつぶせませんでした。"); }
      return;
    }
    if (activePointerId.current === event.pointerId && tool === "shape" && shapeOrigin.current) {
      const result = createShapeStroke(shapeKind, shapeOrigin.current, pointFromEvent(event), pageWidth, pageHeight, penWidth, penColor);
      handlePointerCancel(event);
      if (result) onStrokeComplete(result);
      return;
    }
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
    shapeOrigin.current = null;
    setDraft(null);
    onStrokeComplete(completedStroke);
  }

  function handlePointerCancel(event: PointerEvent<SVGSVGElement>) {
    if (activePointerId.current !== event.pointerId) return;

    activePointerId.current = null;
    currentStroke.current = null;
    shapeOrigin.current = null;
    setDraft(null);
    erasedStrokes.current = null;
    previousEraserPoint.current = null;
    setErasePreview(null);
    setEraserPosition(null);
  }

  const visibleStrokes = [...(erasePreview ?? strokes), ...(draft ? [draft] : [])];
  return (
    <svg
      className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
      style={{ pointerEvents: interactive ? "auto" : "none" }}
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      preserveAspectRatio="none"
      aria-label={tool === "fill" ? "囲んだ内側を塗りつぶす領域" : tool === "shape" ? "ドラッグして図形を描く領域" : tool === "eraser" ? "書き込みを部分的に消す領域" : tool === "marker" ? "マーカーで書き込む領域" : "ペンで書き込む領域"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    >
      <rect width={pageWidth} height={pageHeight} fill="transparent" pointerEvents={interactive ? "all" : "none"} />
      {[...visibleStrokes.filter((stroke) => stroke.kind === "fill"), ...visibleStrokes.filter((stroke) => stroke.kind !== "fill")].map((stroke, index) => (
        <path
          key={index}
          d={strokePath(stroke, pageWidth, pageHeight) + (stroke.kind === "fill" ? " Z" : "")}
          fill={stroke.kind === "fill" ? stroke.color ?? PEN_COLOR : "none"}
          fillRule={stroke.kind === "fill" ? "evenodd" : undefined}
          stroke={stroke.kind === "fill" ? "none" : stroke.color ?? PEN_COLOR}
          strokeWidth={stroke.width}
          strokeOpacity={stroke.kind === "marker" ? MARKER_OPACITY : undefined}
          style={stroke.kind === "marker" ? { mixBlendMode: "multiply" } : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      ))}
      {/* ページ縦横比を補正し、表示上では円形の消しゴム範囲を示す。 */}
      {tool === "eraser" && eraserPosition && <ellipse
        cx={eraserPosition.point.x * pageWidth} cy={eraserPosition.point.y * pageHeight}
        rx={eraserWidth / 2} ry={eraserWidth / 2}
        fill="none" stroke="#666666" strokeWidth={1 / pageScale} pointerEvents="none" />}
      {fillMessage && <foreignObject x={0} y={0} width={pageWidth} height={Math.min(pageHeight, 80 / pageScale)} pointerEvents="none">
        <p role="status" className="rounded bg-base-100 p-2 text-error shadow" style={{ fontSize: 14 / pageScale }}>{fillMessage}</p>
      </foreignObject>}
    </svg>
  );
}
