"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { annotationBounds, encodeAnnotationClipboard, decodeAnnotationClipboard, moveAnnotations, pasteAnnotations, selectAnnotations, selectedContent,
  type AnnotationContent, type AnnotationSelection } from "../annotationSelection";
import { annotationClipboard, bindAnnotationClipboard } from "../annotationClipboard";
import { loadedNoteFont, loadNoteFont } from "../noteFont";
import type { PageInteraction } from "../pageGestures";
import type { StickyFocusRequest } from "../stickyNavigation";
import { textNoteLayout } from "../textLayout";
import type { PenPoint, PenStroke, TextNote } from "../types";
import { PenLayer } from "./PenLayer";
import { TextLayer } from "./TextLayer";

type Snapshot = { content: AnnotationContent; selection: AnnotationSelection };
type Gesture = { base: AnnotationContent; pointer: number; start: PenPoint; path: PenPoint[]; moving: boolean; preview: AnnotationContent; snapshot: Snapshot | null };
const EMPTY = { strokes: [], texts: [] } satisfies AnnotationSelection;

export function LassoLayer({ strokes, texts, pageWidth, pageHeight, pageScale, interaction, disabled, controlsContainer, controlsActive = true, stickyFocus, onChange }: {
  strokes: PenStroke[]; texts: TextNote[]; pageWidth: number; pageHeight: number; pageScale: number;
  interaction: PageInteraction; disabled: boolean; controlsContainer: HTMLDivElement | null;
  stickyFocus?: StickyFocusRequest;
  controlsActive?: boolean;
  onChange: (strokes: PenStroke[], texts: TextNote[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [font, setFont] = useState(loadedNoteFont);
  const [error, setError] = useState("");
  const copied = useSyncExternalStore(annotationClipboard.subscribe, annotationClipboard.get, () => "");
  const content = useMemo(() => ({ strokes, texts }), [strokes, texts]);
  const current = snapshot && snapshot.content.strokes === strokes && snapshot.content.texts === texts ? snapshot : null;
  const selection = current?.selection ?? EMPTY;
  const textBounds = (note: TextNote) => {
    if (!font) throw new Error("文字用フォントの準備中です。少し待ってから操作してください。");
    const layout = textNoteLayout(note, pageWidth, font.font, pageHeight);
    return { left: note.x, top: note.y, right: note.x + layout.width / pageWidth, bottom: note.y + layout.height / pageHeight };
  };
  const activeGesture = gesture?.base.strokes === strokes && gesture.base.texts === texts ? gesture : null;
  const shown = activeGesture?.preview ?? content;
  const bounds = annotationBounds(selectedContent(shown, selection), textBounds, pageWidth, pageHeight);
  const count = selection.strokes.length + selection.texts.length;
  const clear = () => { gestureRef.current = null; setGesture(null); setSnapshot(null); };
  const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : "操作できませんでした。");
  const copy = () => {
    if (disabled || interaction.blocked || gestureRef.current || !count) return null;
    try {
      const picked = selectedContent(content, selection);
      const data = encodeAnnotationClipboard(picked, pageWidth, pageHeight);
      annotationClipboard.set(data); setError("");
      return { data, text: picked.texts.map((note) => note.text).join("\n") };
    } catch (reason) { fail(reason); return null; }
  };
  const paste = (data: string) => {
    if (disabled || interaction.blocked || gestureRef.current) return;
    try {
      const next = pasteAnnotations(content, decodeAnnotationClipboard(data), pageWidth, pageHeight, textBounds);
      onChange(next.content.strokes, next.content.texts);
      setSnapshot(next); setError("");
    } catch (reason) { fail(reason); }
  };
  const latest = useRef({ copy, paste, clear, disabled, controlsContainer, controlsActive });
  useLayoutEffect(() => { latest.current = { copy, paste, clear, disabled, controlsContainer, controlsActive }; });
  useEffect(() => {
    let active = true;
    void loadNoteFont().then((value) => { if (active) setFont(value); }).catch((reason) => { if (active) fail(reason); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const cancel = () => { gestureRef.current = null; setGesture(null); };
    interaction.cancellations.add(cancel);
    return () => { interaction.cancellations.delete(cancel); };
  }, [interaction]);
  useEffect(() => bindAnnotationClipboard(window, {
    owns: (target) => !latest.current.disabled && !document.querySelector("dialog[open], [role=dialog][aria-modal=true]")
      && target instanceof Node && (!!svgRef.current?.closest(".pdf-viewport")?.contains(target) || (latest.current.controlsActive && !!latest.current.controlsContainer?.contains(target))),
    copy: () => latest.current.copy(), paste: (data) => latest.current.paste(data), clear: () => latest.current.clear(),
  }), []);

  const point = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const progress = (event: PointerEvent<SVGSVGElement>, finished = false) => {
    const previous = gestureRef.current;
    if (!previous || previous.pointer !== event.pointerId || (previous.base.strokes !== strokes || previous.base.texts !== texts) || interaction.blocked || disabled) return null;
    const p = point(event);
    if (previous.moving && previous.snapshot) {
      const preview = moveAnnotations(previous.snapshot.content, previous.snapshot.selection, { x: p.x - previous.start.x, y: p.y - previous.start.y }, textBounds, pageWidth, pageHeight);
      return { ...previous, preview };
    }
    const last = previous.path.at(-1)!;
    if (!finished && Math.hypot((last.x - p.x) * pageWidth * pageScale, (last.y - p.y) * pageHeight * pageScale) < 3) return previous;
    // 長い操作でも輪郭の始点・終点を維持し、無制限には蓄積しない。
    const path = previous.path.length >= 256 ? previous.path.filter((_, i) => i % 2 === 0) : previous.path;
    return { ...previous, path: [...path, p] };
  };
  const finish = (event: PointerEvent<SVGSVGElement>) => {
    try {
      const next = progress(event, true);
      if (!next) return;
      gestureRef.current = null; setGesture(null);
      if (next.moving) {
        if (next.preview.strokes !== strokes || next.preview.texts !== texts) { onChange(next.preview.strokes, next.preview.texts); setSnapshot({ content: next.preview, selection }); }
      } else {
        setSnapshot({ content, selection: selectAnnotations(content, next.path, textBounds) });
      }
    } catch (reason) { gestureRef.current = null; setGesture(null); fail(reason); }
  };
  const controls = <div className="flex items-center gap-2" role="group" aria-label="投げ縄の操作">
    <span className="text-sm text-base-content/70">{count ? `${count}件選択` : "囲んで選択"}</span>
    <button type="button" className="btn btn-sm" disabled={disabled || !count || !!gesture} title="Ctrl／Command+C" onClick={copy}>コピー</button>
    <button type="button" className="btn btn-sm" disabled={disabled || !copied || !!gesture} title="Ctrl／Command+V" onClick={() => paste(copied)}>貼り付け</button>
    <button type="button" className="btn btn-sm" disabled={disabled || !count || !!gesture} onClick={clear}>選択解除</button>
  </div>;
  return <>
    <PenLayer strokes={shown.strokes} pageWidth={pageWidth} pageHeight={pageHeight} pageScale={pageScale}
      penWidth={1} penColor="#000000" tool="pen" eraserWidth={1} interactive={false} onStrokeComplete={() => {}} onStrokesChange={() => {}} />
    {shown.texts.length > 0 && <TextLayer notes={shown.texts} tool="hand" disabled stickyFocus={stickyFocus} pageWidth={pageWidth} pageHeight={pageHeight} pageScale={pageScale} onChange={() => {}} />}
    <svg ref={svgRef} className="absolute left-0 top-0 touch-none" aria-label="投げ縄で書き込みを選択・移動"
      style={{ width: pageWidth * pageScale, height: pageHeight * pageScale, cursor: gesture?.moving ? "grabbing" : count ? "grab" : "crosshair" }}
      viewBox={`0 0 ${pageWidth} ${pageHeight}`} onPointerDown={(event) => {
        if (disabled || interaction.blocked || gestureRef.current || event.button !== 0 || !event.isPrimary) return;
        if (texts.length && !font) { setError("文字用フォントの準備中です。少し待ってから操作してください。"); return; }
        event.preventDefault(); event.currentTarget.closest<HTMLElement>(".pdf-viewport")?.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId); setError("");
        const start = point(event);
        const moving = !!bounds && start.x >= bounds.left - 6 / pageWidth && start.x <= bounds.right + 6 / pageWidth
          && start.y >= bounds.top - 6 / pageHeight && start.y <= bounds.bottom + 6 / pageHeight;
        if (!moving) setSnapshot(null);
        const next = { base: content, pointer: event.pointerId, start, path: [start], moving, preview: content, snapshot: current };
        gestureRef.current = next; setGesture(next);
      }} onPointerMove={(event) => {
        try { const next = progress(event); if (next) { gestureRef.current = next; setGesture(next); } } catch (reason) { clear(); fail(reason); }
      }} onPointerUp={finish} onPointerCancel={() => { gestureRef.current = null; setGesture(null); }}
      onLostPointerCapture={() => { gestureRef.current = null; setGesture(null); }}>
      <rect width={pageWidth} height={pageHeight} fill="transparent" />
      {gesture && !gesture.moving && <polygon points={gesture.path.map((p) => `${p.x * pageWidth},${p.y * pageHeight}`).join(" ")}
        fill="#2563eb12" stroke="#2563eb" strokeWidth={1.5 / pageScale} strokeDasharray={`${5 / pageScale} ${4 / pageScale}`} pointerEvents="none" />}
      {bounds && <rect x={bounds.left * pageWidth - 3 / pageScale} y={bounds.top * pageHeight - 3 / pageScale}
        width={(bounds.right - bounds.left) * pageWidth + 6 / pageScale} height={(bounds.bottom - bounds.top) * pageHeight + 6 / pageScale}
        fill="none" stroke="#2563eb" strokeWidth={1.5 / pageScale} strokeDasharray={`${5 / pageScale} ${4 / pageScale}`} pointerEvents="none" />}
    </svg>
    {controlsActive && (controlsContainer ? createPortal(controls, controlsContainer) : <div className="absolute left-1 top-1 bg-base-100 p-1">{controls}</div>)}
    {error && <div className="absolute left-1 top-1 max-w-full bg-base-100 p-2 text-sm text-error" role="alert">{error}
      <button type="button" className="btn btn-sm ml-2" onClick={() => { setError(""); if (!font) void loadNoteFont().then(setFont).catch(fail); }}>閉じる</button></div>}
  </>;
}
