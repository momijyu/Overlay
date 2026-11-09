import { useEffect, useRef, useState, type FocusEvent } from "react";
import type { Font } from "@pdf-lib/fontkit";
import { MAX_NOTE_TEXT_LENGTH, MAX_NOTE_FONT_SIZE, MIN_NOTE_FONT_SIZE, normalizeNoteText } from "../textData";
import { fitTextNote, textNoteLayout, TEXT_PADDING, STICKY_BACKGROUND } from "../textLayout";
import type { TextNote } from "../types";
import { TextSizeControl } from "./TextSizeControl";
import { isPenColor, PEN_COLOR } from "../penStyle";
import { textEditorOptionsPosition } from "../textEditorPlacement";

export function TextBoxEditor({ note, font, pageWidth, pageHeight, pageScale, existing, openedByPointer = false, onCommit, onCancel, onDelete, onPreview }: {
  note: TextNote;
  font: Font;
  pageWidth: number;
  pageHeight: number;
  pageScale: number;
  existing: boolean;
  openedByPointer?: boolean;
  onCommit: (note: TextNote) => void;
  onCancel: () => void;
  onDelete?: () => void;
  onPreview?: (note: TextNote) => void;
}) {
  const [text, setText] = useState(note.text);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(note.fontSize);
  const [fitToText, setFitToText] = useState(note.autoSize ?? false);
  const [colors, setColors] = useState({ color: note.color, backgroundColor: note.backgroundColor });
  const root = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const closed = useRef(false);
  const blurredWhileComposing = useRef(false);
  const draft = useRef(note.text);
  const draftSize = useRef(note.fontSize);
  const draftAutoSize = useRef(note.autoSize ?? false);
  const ignoreOpeningClick = useRef(openedByPointer);
  const draftColors = useRef(colors);

  function snapshot(text = draft.current, size = draftSize.current, autoSize = draftAutoSize.current): TextNote {
    return { ...note, ...draftColors.current, text: normalizeNoteText(text), fontSize: size, ...(autoSize ? { autoSize: true } : {}) };
  }

  function changeColor(field: "color" | "backgroundColor", value: string) {
    if (composing.current || !isPenColor(value) || (field === "backgroundColor" && note.kind !== "sticky")) return;
    draftColors.current = { ...draftColors.current, [field]: value };
    setColors(draftColors.current);
    setError(null);
    // 色だけの変更では、旧ボックスの幅・高さを自動サイズへ切り替えない。
    try { onPreview?.(fitTextNote(snapshot(), pageWidth, pageHeight, font)); }
    catch { /* 入力中の文章は保持し、確定時に検証する。 */ }
  }

  function changeSize(size: number) {
    if (composing.current || !Number.isInteger(size) || size < MIN_NOTE_FONT_SIZE || size > MAX_NOTE_FONT_SIZE) return;
    try {
      const fitted = fitTextNote(snapshot(draft.current, size, true), pageWidth, pageHeight, font);
      draftSize.current = size; draftAutoSize.current = true;
      setFontSize(size); setFitToText(true); setError(null);
      onPreview?.(fitted);
    } catch (error) { setError(error instanceof Error ? error.message : "文字サイズを変更できませんでした。"); }
  }

  function cancel() {
    if (closed.current) return;
    closed.current = true;
    onCancel();
  }

  function finish() {
    if (closed.current) return true;
    if (composing.current) return false;
    try {
      const normalized = normalizeNoteText(draft.current);
      if (!normalized.trim() && !existing) { cancel(); return true; }
      if (!normalized.trim()) throw new Error("文章を入力してください。");
      if (normalized.length > MAX_NOTE_TEXT_LENGTH) throw new Error(`文章は${MAX_NOTE_TEXT_LENGTH}文字以内にしてください。`);
      const fitted = fitTextNote(snapshot(normalized), pageWidth, pageHeight, font);
      onCommit(fitted);
      closed.current = true;
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "変更できませんでした。");
      return false;
    }
  }

  const finishRef = useRef(finish);
  useEffect(() => { finishRef.current = finish; });
  useEffect(() => {
    // ボタンの処理より先に確定する。ページ・道具・ノート切替やダウンロードも最新の文章を使う。
    function outside(event: Event) {
      // pointerdownで入力欄を作ると、その同じ操作のclickがPDF側へ来る場合がある。
      // それを外側クリックと誤認し、空の新規ボックスを即キャンセルしない。
      if (event.type === "pointerdown") ignoreOpeningClick.current = false;
      if (event.type === "click" && ignoreOpeningClick.current) { ignoreOpeningClick.current = false; return; }
      if (root.current?.contains(event.target as Node)) return;
      if (!finishRef.current()) { event.preventDefault(); event.stopPropagation(); textarea.current?.focus(); }
    }
    function leaving() { finishRef.current(); }
    function visibility() { if (document.visibilityState === "hidden") leaving(); }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("click", outside, true); // キーボードによるボタン操作も対象。
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", leaving);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("click", outside, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", leaving);
    };
  }, []);

  function blur(event: FocusEvent) {
    if (root.current?.contains(event.relatedTarget as Node)) return;
    if (composing.current) { blurredWhileComposing.current = true; return; }
    if (!finish()) textarea.current?.focus();
  }

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const style = root.current?.parentElement?.style;
      style?.setProperty("--editor-keyboard-offset", `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
      style?.setProperty("--editor-visible-height", `${Math.max(0, viewport.height - 16)}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  let fitted: TextNote = { ...note, ...colors, fontSize, ...(fitToText ? { autoSize: true } : {}) };
  try { fitted = fitTextNote({ ...fitted, text: normalizeNoteText(text) }, pageWidth, pageHeight, font); }
  catch { /* 不正な入力も捨てず、直せるよう入力欄に残す。 */ }
  let layout;
  try { layout = textNoteLayout(fitted, pageWidth, font, pageHeight); }
  catch { layout = textNoteLayout({ ...fitted, text: "" }, pageWidth, font, pageHeight); }
  const leading = layout.lineHeight - (font.ascent - font.descent) / font.unitsPerEm * fitted.fontSize;
  const optionsRef = useRef<HTMLDivElement>(null);
  const repositionRef = useRef<() => void>(() => {});
  useEffect(() => {
    const panel = root.current, options = optionsRef.current;
    if (!panel || !options || typeof window.getComputedStyle !== "function") return;
    function reposition() {
      // タッチ用の下部入力パネルはCSS側で配置する。向き変更後も同じ要素を使う。
      if (window.getComputedStyle(options!).position !== "absolute") return;
      const visual = window.visualViewport;
      const viewport = { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0,
        right: (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth),
        bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight) };
      const clipping = panel!.closest(".pdf-viewport")?.getBoundingClientRect();
      if (clipping) {
        viewport.left = Math.max(viewport.left, clipping.left); viewport.top = Math.max(viewport.top, clipping.top);
        viewport.right = Math.min(viewport.right, clipping.right); viewport.bottom = Math.min(viewport.bottom, clipping.bottom);
      }
      const size = options!.getBoundingClientRect();
      const position = textEditorOptionsPosition(panel!.getBoundingClientRect(), size.width, size.height, viewport, pageScale);
      for (const [name, value] of Object.entries(position)) options!.style.setProperty(`--editor-options-${name}`, `${value}px`);
    }
    repositionRef.current = reposition;
    reposition();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(reposition);
    observer?.observe(panel); observer?.observe(options);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      repositionRef.current = () => {};
      observer?.disconnect(); window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [pageScale]);
  useEffect(() => { repositionRef.current(); }, [fitted.x, fitted.y, layout.width, layout.height]);

  return <div className="text-editor-surface absolute left-0 top-0 pointer-events-none" style={{ width: pageWidth, height: pageHeight,
    transform: `scale(${pageScale})`, transformOrigin: "top left" }}>
    <div ref={root} data-text-editor className="text-editor-panel absolute pointer-events-auto" style={{ left: fitted.x * pageWidth, top: fitted.y * pageHeight,
      width: layout.width, height: layout.height }} onPointerDown={(event) => event.stopPropagation()}>
      <textarea ref={textarea} data-note-kind={note.kind} aria-label={note.kind === "sticky" ? "付箋" : "テキストボックス"} className="textarea block rounded-none"
        autoFocus value={text} maxLength={MAX_NOTE_TEXT_LENGTH} spellCheck={false} wrap="soft"
        style={{ width: "100%", height: "100%", minHeight: 0, resize: "none", overflow: "auto", boxSizing: "border-box",
          padding: `${TEXT_PADDING - leading / 2}px ${TEXT_PADDING}px`, border: "none", outline: "1px solid #666666", outlineOffset: -1,
          background: note.kind === "sticky" ? fitted.backgroundColor ?? STICKY_BACKGROUND : "transparent",
          color: fitted.color ?? PEN_COLOR, fontFamily: "OverlayNotes", fontSize: fitted.fontSize,
          lineHeight: `${layout.lineHeight}px`, fontKerning: "none", fontVariantLigatures: "none",
          fontWeight: 400, fontStyle: "normal", letterSpacing: "normal",
          whiteSpace: "pre-wrap", wordBreak: "break-all", lineBreak: "anywhere", overflowWrap: "anywhere" }}
        onChange={(event) => {
          draft.current = event.target.value;
          draftAutoSize.current = true;
          setText(event.target.value); setFitToText(true); setError(null);
          try { onPreview?.(fitTextNote(snapshot(), pageWidth, pageHeight, font)); }
          catch { /* 入力を残し、確定時にエラーを案内する。 */ }
        }} onBlur={blur}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => {
          composing.current = false;
          // IMEの最後のonChangeが反映された次のイベント（blur/click）で確定する。
          if (blurredWhileComposing.current) { blurredWhileComposing.current = false; textarea.current?.focus(); }
        }}
        onKeyDown={(event) => {
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape") { event.preventDefault(); cancel(); }
          else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(); }
        }} />
      <div ref={optionsRef} className="text-editor-options absolute w-72 space-y-1 rounded-box border border-base-300 bg-base-100 p-2 shadow-sm"
        style={{ left: "var(--editor-options-left, 0px)", top: "var(--editor-options-top, 100%)",
          transform: `scale(${1 / pageScale})`, transformOrigin: "top left" }}>
        <TextSizeControl value={fontSize} onChange={changeSize} />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-sm">文字色
            <input type="color" className="input input-xs w-10 p-0.5" aria-label="文字色"
              value={colors.color ?? PEN_COLOR} onChange={(event) => changeColor("color", event.target.value)} />
          </label>
          {note.kind === "sticky" && <label className="flex items-center gap-1 text-sm">背景色
            <input type="color" className="input input-xs w-10 p-0.5" aria-label="付箋の背景色"
              value={colors.backgroundColor ?? STICKY_BACKGROUND}
              onChange={(event) => changeColor("backgroundColor", event.target.value)} />
          </label>}
        </div>
        {error && <p className="text-editor-error text-sm text-error [overflow-wrap:anywhere]" role="alert">{error}</p>}
        <div className="text-editor-actions flex flex-wrap gap-1" onPointerDown={(event) => event.preventDefault()}>
          <button type="button" className="btn btn-xs" onClick={() => finish()}>完了</button>
          <button type="button" className="btn btn-xs" onClick={cancel}>キャンセル</button>
          {onDelete && <button type="button" className="btn btn-xs" onClick={() => {
            closed.current = true; onDelete();
          }}>削除</button>}
        </div>
      </div>
    </div>
  </div>;
}
