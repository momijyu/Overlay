"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_TAPE_COLOR, LEGACY_TAPE_COLOR, moveTape, tapeRectangle } from "../maskTapes";
import { isPenColor } from "../penStyle";
import type { PageInteraction } from "../pageGestures";
import type { MaskTape, PenPoint } from "../types";

type Props = {
  scope: object;
  tapes: MaskTape[];
  width: number;
  height: number;
  scale: number;
  active: boolean;
  revealable: boolean;
  disabled: boolean;
  interaction: PageInteraction;
  controls: HTMLDivElement | null;
  onChange(tapes: MaskTape[]): void;
};

type Gesture = {
  pointer: number;
  context: object;
  start: PenPoint;
  original: MaskTape;
  mode: "create" | "move" | "resize";
  moved: boolean;
};

export function TapeLayer({ scope, tapes, width, height, scale, active, revealable, disabled, interaction, controls, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const context = useMemo(() => ({ scope, tapes, width, height, scale, active, revealable, disabled }), [scope, tapes, width, height, scale, active, revealable, disabled]);
  const [selected, setSelected] = useState<string | null>(null);
  const [color, setColor] = useState(DEFAULT_TAPE_COLOR);
  const [visibility, setVisibility] = useState<{
    scope: object;
    tapes: MaskTape[];
    ids: string[];
  } | null>(null);
  const revealed = visibility?.scope === scope && visibility.tapes === tapes ? visibility.ids : [];
  const [draft, setDraft] = useState<{
    context: object;
    tape: MaskTape;
  } | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const previewRef = useRef<MaskTape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedTape = tapes.find((tape) => tape.id === selected);
  function preview(tape: MaskTape | null) {
    previewRef.current = tape;
    setDraft(tape && { context, tape });
  }

  useEffect(() => {
    const cancel = () => {
      gestureRef.current = null;
      previewRef.current = null;
      setDraft(null);
    };
    interaction.cancellations.add(cancel);
    window.addEventListener("blur", cancel);
    return () => {
      interaction.cancellations.delete(cancel);
      window.removeEventListener("blur", cancel);
    };
  }, [interaction]);

  function commit(next: MaskTape[]) {
    try {
      onChange(next);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "テープを保存できませんでした。");
    }
  }

  function toggle(id: string) {
    if (disabled || interaction.blocked)
      return;
    setSelected(id);
    setVisibility({ scope, tapes, ids: revealed.includes(id) ? revealed.filter((value) => value !== id) : [...revealed, id] });
  }

  function point(event: {
    clientX: number;
    clientY: number;
  }): PenPoint {
    const rect = rootRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / (width * scale))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / (height * scale))) };
  }

  function down(event: PointerEvent<HTMLElement>, tape?: MaskTape, resize = false) {
    if (!active || disabled || interaction.blocked || event.button !== 0 || gestureRef.current)
      return;
    event.preventDefault();
    event.stopPropagation();
    const start = point(event);
    const original = tape ?? { id: crypto.randomUUID(), x: start.x, y: start.y,
      width: Math.min(.22, 1 - start.x), height: Math.min(.05, 1 - start.y), color };
    setSelected(original.id);
    preview(original);
    let mode: Gesture["mode"] = "create";
    if (tape) mode = resize ? "resize" : "move";
    gestureRef.current = { pointer: event.pointerId, start, original, context, mode, moved: false };
    rootRef.current?.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.context !== context || gesture.pointer !== event.pointerId || disabled || interaction.blocked)
      return;
    const end = point(event);
    const offsetX = end.x - gesture.start.x;
    const offsetY = end.y - gesture.start.y;
    if (Math.hypot(offsetX * width * scale, offsetY * height * scale) < 4 && !gesture.moved)
      return;
    gesture.moved = true;
    let next: MaskTape;
    if (gesture.mode === "create") {
      next = { ...gesture.original, ...tapeRectangle(gesture.start, end) };
    } else if (gesture.mode === "move") {
      next = moveTape(gesture.original, offsetX, offsetY);
    } else {
      next = { ...gesture.original,
        width: Math.min(1 - gesture.original.x, Math.max(12 / width, gesture.original.width + offsetX)),
        height: Math.min(1 - gesture.original.y, Math.max(12 / height, gesture.original.height + offsetY)) };
    }
    preview(next);
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancel = false) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointer !== event.pointerId)
      return;
    gestureRef.current = null;
    const next = previewRef.current;
    preview(null);
    if (cancel || gesture.context !== context || !active || disabled || interaction.blocked || !next)
      return;
    if (gesture.mode !== "create" && !gesture.moved) {
      if (gesture.mode === "move")
        toggle(gesture.original.id);
      return;
    }
    if (next.width * width < 4 || next.height * height < 4)
      return;
    commit(gesture.mode === "create" ? [...tapes, next] : tapes.map((tape) => tape.id === next.id ? next : tape));
  }
  const currentDraft = draft?.context === context ? draft.tape : null;
  const shown = currentDraft && !tapes.some((tape) => tape.id === currentDraft.id) ? [...tapes, currentDraft] : tapes;
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2" aria-label="目隠しテープの操作">
      <button type="button" className="btn btn-sm min-h-11" disabled={disabled} onClick={() => {
        const tape = { id: crypto.randomUUID(), x: .35, y: .4, width: .3, height: .06, color };
        commit([...tapes, tape]);
        setSelected(tape.id);
      }}>テープを追加</button>
      <label className="flex min-h-11 items-center gap-2 text-sm">テープの色
        <input type="color" className="input input-sm h-11 w-12 p-1" aria-label="テープの色" disabled={disabled}
          value={selectedTape ? selectedTape.color ?? LEGACY_TAPE_COLOR : color}
          onChange={(event) => {
            const next = event.target.value;
            if (disabled || interaction.blocked || !isPenColor(next)) return;
            setColor(next);
            if (selectedTape && next !== (selectedTape.color ?? LEGACY_TAPE_COLOR)) {
              commit(tapes.map((tape) => tape.id === selectedTape.id ? { ...tape, color: next } : tape));
            }
          }} />
      </label>
      <button type="button" className="btn btn-sm min-h-11" disabled={disabled || !revealed.length}
        onClick={() => setVisibility(null)}>すべて隠す</button>
      {selectedTape && <button type="button" className="btn btn-sm min-h-11 text-error" disabled={disabled}
        onClick={() => {
          commit(tapes.filter((tape) => tape.id !== selectedTape.id));
          setSelected(null);
        }}>テープ削除</button>}
      <span className="sr-only">ドラッグで配置・移動、タップで表示切替</span>
      {error && <span role="alert" className="text-sm text-error whitespace-normal">{error}</span>}
    </div>
  );
  return <>
    <div ref={rootRef} className="absolute inset-0 touch-none" aria-label="目隠しテープレイヤー"
      style={{ width: width * scale, height: height * scale, pointerEvents: active && !disabled ? "auto" : "none" }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) down(event);
      }}
      onPointerMove={move} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}>
      {shown.map((tape) => {
        const value = currentDraft?.id === tape.id ? currentDraft : tape;
        const open = revealed.includes(tape.id);
        const interactive = (active || revealable) && !disabled;
        return <div key={tape.id} className="absolute" style={{
          left: `${value.x * 100}%`, top: `${value.y * 100}%`,
          width: `${value.width * 100}%`, height: `${value.height * 100}%`,
        }}>
          <button type="button" data-mask-tape="true" className="absolute inset-0 h-full w-full border border-black/40"
            style={{
              background: open ? "transparent" : value.color ?? LEGACY_TAPE_COLOR,
              pointerEvents: interactive ? "auto" : "none",
              outline: active && selected === tape.id ? "2px solid #2563eb" : undefined,
              cursor: active ? "move" : "pointer",
            }}
            aria-label={open ? "答えを隠す" : "答えを表示"} aria-pressed={open}
            disabled={!interactive} tabIndex={interactive ? 0 : -1}
            onPointerDown={(event) => down(event, tape)}
            onClick={(event) => {
              if (revealable || event.detail === 0) toggle(tape.id);
            }} />
          {active && selected === tape.id && <button type="button" data-mask-tape="true"
            className="absolute -bottom-3 -right-3 size-8 rounded-full border-2 border-blue-600 bg-white"
            style={{ pointerEvents: disabled ? "none" : "auto", cursor: "nwse-resize" }} disabled={disabled}
            aria-label="テープのサイズ変更" onPointerDown={(event) => down(event, tape, true)} />}
        </div>;
      })}
    </div>
    {active && controls && createPortal(toolbar, controls)}
  </>;
}
