"use client";

import { useRef, useState, type PointerEvent } from "react";

import { PEN_COLOR, PEN_WIDTH } from "../penStyle";
import type { PenPoint, PenStroke } from "../types";

type PenLayerProps = {
  strokes: PenStroke[];
  onStrokeComplete: (stroke: PenStroke) => void;
};

function pointFromEvent(event: PointerEvent<SVGSVGElement>): PenPoint {
  const bounds = event.currentTarget.getBoundingClientRect();

  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
  };
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

export function PenLayer({ strokes, onStrokeComplete }: PenLayerProps) {
  const activePointerId = useRef<number | null>(null);
  const currentStroke = useRef<PenStroke | null>(null);
  const [draft, setDraft] = useState<PenStroke | null>(null);

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (activePointerId.current !== null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerId.current = event.pointerId;
    currentStroke.current = { points: [pointFromEvent(event)] };
    setDraft(currentStroke.current);
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (activePointerId.current !== event.pointerId || !currentStroke.current) {
      return;
    }

    currentStroke.current = {
      points: [...currentStroke.current.points, pointFromEvent(event)],
    };
    setDraft(currentStroke.current);
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    if (activePointerId.current !== event.pointerId || !currentStroke.current) {
      return;
    }

    const completedStroke = {
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
  }

  return (
    <svg
      className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-label="ペンで書き込む領域"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    >
      <rect width="1" height="1" fill="transparent" pointerEvents="all" />
      {[...strokes, ...(draft ? [draft] : [])].map((stroke, index) => (
        <path
          key={index}
          d={strokePath(stroke)}
          fill="none"
          stroke={PEN_COLOR}
          strokeWidth={PEN_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
    </svg>
  );
}
