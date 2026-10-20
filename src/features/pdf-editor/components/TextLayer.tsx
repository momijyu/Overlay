import { useEffect, useRef, useState, type PointerEvent } from "react";
import { loadNoteFont, loadedNoteFont, type NoteFont } from "../noteFont";
import { fitTextNote, textNoteLayout, TEXT_PADDING, STICKY_BACKGROUND } from "../textLayout";
import { readTextNotes } from "../textData";
import type { EditorTool, TextNote } from "../types";
import { TextBoxEditor } from "./TextBoxEditor";
import { PEN_COLOR } from "../penStyle";

export function TextLayer({ notes, tool, pageWidth, pageHeight, pageScale = 1, disabled = false, onChange }: {
  notes: TextNote[];
  tool: EditorTool;
  pageWidth: number;
  pageHeight: number;
  pageScale?: number;
  disabled?: boolean;
  onChange: (notes: TextNote[]) => void;
}) {
  const [font, setFont] = useState<NoteFont | null>(loadedNoteFont);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<TextNote | null>(null);
  const [openedByPointer, setOpenedByPointer] = useState(false);
  const [previewState, updatePreview] = useState<{
    note: TextNote; notes: TextNote[]; tool: EditorTool; scale: number; editing: boolean;
  } | null>(null);
  const drag = useRef<{ id: number; note: TextNote; x: number; y: number; moved: boolean } | null>(null);
  const committed = useRef<TextNote | null>(null);
  const active = !disabled && (tool === "text" || tool === "sticky");
  const preview = previewState?.notes === notes && !disabled
    && (previewState.editing || (previewState.tool === tool && previewState.scale === pageScale)) ? previewState.note : null;
  function setPreview(note: TextNote | null, editing = false) {
    updatePreview(note ? { note, notes, tool, scale: pageScale, editing } : null);
  }
  useEffect(() => () => { drag.current = null; }, [tool, pageScale, disabled]);
  useEffect(() => {
    const current = drag.current;
    // 同じpointerdownで文章確定→枠ドラッグを始めた場合は維持し、Undo等で対象が変われば中断する。
    if (current && !notes.some((note) => note.id === current.note.id
      && JSON.stringify(note) === JSON.stringify(current.note))) drag.current = null;
  }, [notes]);
  useEffect(() => {
    let live = true;
    loadNoteFont().then((value) => { if (live) { setFont(value); setError(null); } })
      .catch(() => { if (live) setError("日本語フォントを読み込めませんでした。"); });
    return () => { live = false; };
  }, [retry]);

  function save(note: TextNote) {
    if (!font) return;
    const fitted = fitTextNote(note, pageWidth, pageHeight, font.font);
    readTextNotes({ 1: [fitted] });
    committed.current = fitted;
    const current = notes.find((item) => item.id === note.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(fitted)) {
      onChange(current ? notes.map((item) => item.id === note.id ? fitted : item) : [...notes, fitted]);
    }
    setSelected(note.id);
    setEditing(null);
    setPreview(null);
  }

  function createNote(x: number, y: number, kind: "text" | "sticky", fromPointer = false) {
    if (!font) return;
    const width = Math.min(0.4, 240 / pageWidth);
    const created = fitTextNote({ id: crypto.randomUUID(), kind, text: "", x, y, width, fontSize: 14,
      autoSize: true }, pageWidth, pageHeight, font.font);
    committed.current = null;
    setOpenedByPointer(fromPointer);
    setEditing(created);
    setSelected(null);
    setPreview(null);
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!active || !font || drag.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    const id = (event.target as Element).closest?.("[data-note-id]")?.getAttribute("data-note-id");
    const action = (event.target as Element).closest?.("[data-note-action]")?.getAttribute("data-note-action");
    // 入力欄の外側の枠なら、captureで確定した最新文章をそのまま移動する。
    if (editing && (!action || committed.current?.id !== editing.id)) return;
    const note = editing ? committed.current : notes.find((item) => item.id === id);
    if (note) {
      setSelected(note.id);
      try { fitTextNote(note, pageWidth, pageHeight, font.font); }
      catch { event.preventDefault(); setOpenedByPointer(true); setEditing(note); return; } // 未対応の文字を含むデータも修正できる。
      if (!action) { event.preventDefault(); setOpenedByPointer(true); setEditing(note); return; }
      drag.current = { id: event.pointerId, note, x, y, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else {
      // pointerdownの既定フォーカス移動で、新規textareaが直後にblurして消えるのを防ぐ。
      event.preventDefault();
      createNote(x, y, tool as "text" | "sticky", true);
    }
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId || !font) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const dx = (event.clientX - bounds.left) / bounds.width - current.x;
    const dy = (event.clientY - bounds.top) / bounds.height - current.y;
    if (Math.hypot(dx * bounds.width, dy * bounds.height) < 3 && !current.moved) return;
    current.moved = true;
    const next = fitTextNote({ ...current.note, x: current.note.x + dx, y: current.note.y + dy }, pageWidth, pageHeight, font.font);
    setPreview(next);
    return next;
  }

  function cancel(event: PointerEvent<SVGSVGElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setPreview(null);
  }

  function up(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const next = move(event);
    cancel(event);
    if (current.moved && next) save(next);
  }

  if (!font) return <div className="absolute left-0 top-0 bg-base-100 p-2 text-sm pointer-events-auto">
    {error ? <><p role="alert">{error}</p><button className="btn btn-sm" onClick={() => setRetry((value) => value + 1)}>再試行</button></>
      : <p role="status">テキストを読み込んでいます…</p>}
  </div>;

  return <div className="pointer-events-none absolute inset-0">
    <svg className={`absolute inset-0 h-full w-full ${active ? "pointer-events-auto touch-none" : "pointer-events-none"}`}
      viewBox={`0 0 ${pageWidth} ${pageHeight}`} preserveAspectRatio="none" aria-label="テキストと付箋"
      onPointerDown={pointerDown} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      {active && <rect width={pageWidth} height={pageHeight} fill="transparent" />}
      {notes.map((original) => {
        const note = preview?.id === original.id ? preview : original;
        let layout;
        try { layout = textNoteLayout(note, pageWidth, font.font, pageHeight); }
        catch { return <g key={note.id} data-note-id={note.id}><text x={note.x * pageWidth} y={note.y * pageHeight + 14} fill="red">表示できないテキスト</text></g>; }
        const x = note.x * pageWidth;
        const y = note.y * pageHeight;
        const isEditing = editing?.id === note.id;
        return <g key={note.id} data-note-id={note.id}>
          <rect x={x} y={y} width={layout.width} height={layout.height}
            fill={note.kind === "sticky" ? note.backgroundColor ?? STICKY_BACKGROUND : "transparent"}
            stroke="none" visibility={isEditing ? "hidden" : "visible"} />
          <text fontFamily="OverlayNotes" fontSize={note.fontSize} fill={note.color ?? PEN_COLOR} visibility={isEditing ? "hidden" : "visible"} style={{ fontKerning: "none", fontVariantLigatures: "none", whiteSpace: "pre" }}>
            {layout.lines.map((line, index) => <tspan key={index} x={x + TEXT_PADDING} y={y + layout.baseline + layout.lineHeight * index}>{line}</tspan>)}
          </text>
        </g>;
      })}
    </svg>
    {active && <div className="absolute right-0 top-0 flex gap-1 pointer-events-auto">
      <button className="btn btn-sm" type="button" onClick={() => createNote(0.1, 0.1, tool === "sticky" ? "sticky" : "text")}>
        {tool === "sticky" ? "付箋を追加" : "テキストを追加"}
      </button>
      {!editing && selected && notes.some((note) => note.id === selected) && <>
        <button className="btn btn-sm" type="button" onClick={() => { setOpenedByPointer(false); setEditing(notes.find((note) => note.id === selected)!); }}>文章編集</button>
        <button className="btn btn-sm" type="button" onClick={() => { onChange(notes.filter((note) => note.id !== selected)); setSelected(null); }}>削除</button>
      </>}
    </div>}
    {editing && <TextBoxEditor key={editing.id} note={editing} font={font.font}
      pageWidth={pageWidth} pageHeight={pageHeight} pageScale={pageScale}
      openedByPointer={openedByPointer}
      existing={notes.some((note) => note.id === editing.id)}
      onCommit={save} onCancel={() => { setEditing(null); setPreview(null); }} onPreview={(note) => setPreview(note, true)}
      onDelete={notes.some((note) => note.id === editing.id) ? () => {
        onChange(notes.filter((note) => note.id !== editing.id)); setEditing(null); setSelected(null);
      } : undefined} />}
    {/* 内側はtextareaへ、枠だけは移動へ渡す。サイズは文字に合わせるためハンドルは置かない。 */}
    {active && <svg className="absolute inset-0 h-full w-full pointer-events-none touch-none"
      viewBox={`0 0 ${pageWidth} ${pageHeight}`} preserveAspectRatio="none" aria-label="テキストの選択枠"
      onPointerDown={pointerDown} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      {notes.filter((note) => note.id === selected).map((original) => {
        const note = preview?.id === original.id ? preview : original;
        let layout;
        try { layout = textNoteLayout(note, pageWidth, font.font, pageHeight); } catch { return null; }
        const x = note.x * pageWidth;
        const y = note.y * pageHeight;
        return <g key={note.id} data-note-id={note.id}>
          <rect data-note-action="move" x={x} y={y} width={layout.width} height={layout.height}
            fill="none" stroke="transparent" strokeWidth={10 / pageScale} style={{ pointerEvents: "stroke", cursor: "move" }} />
          <rect x={x} y={y} width={layout.width} height={layout.height}
            fill="none" stroke="#666666" strokeWidth={2 / pageScale} style={{ pointerEvents: "none" }} />
        </g>;
      })}
    </svg>}
  </div>;
}
