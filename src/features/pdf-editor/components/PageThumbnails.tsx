"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createThumbnailQueue, THUMBNAIL_MEDIA_QUERY, THUMBNAIL_ROW_HEIGHT, thumbnailWindow } from "../pageThumbnails";
import { paintThumbnailAnnotations, renderPageThumbnail, type PageThumbnail } from "../renderPageThumbnail";
import type { MaskTape, NoteImages, NotePage, PenStroke, TapesByPage, TextNote, TextNotesByPage } from "../types";
import { EditorIcon } from "./EditorIcon";

type Props = {
  document: PDFDocumentProxy; pages: NotePage[]; currentPage: number; disabled: boolean;
  strokesByPage: Record<number, PenStroke[]>; textsByPage: TextNotesByPage;
  tapesByPage?: TapesByPage; images?: NoteImages; onNavigate: (number: number) => void;
};
const EMPTY_STROKES: PenStroke[] = [], EMPTY_TEXTS: TextNote[] = [], EMPTY_TAPES: MaskTape[] = [];
type Source = ReturnType<typeof createThumbnailQueue<PageThumbnail>>;

function Preview({ page, source, strokes, texts, tapes, images }: {
  page: NotePage; source: Source; strokes: PenStroke[]; texts: TextNote[]; tapes: MaskTape[]; images?: NoteImages;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [base, setBase] = useState<PageThumbnail | null>(null);
  const [status, setStatus] = useState("読み込み中");
  const { id, kind } = page;
  const pageNumber = page.kind === "pdf" ? page.pageNumber : 0;
  const width = page.kind === "blank" ? page.width : 0, height = page.kind === "blank" ? page.height : 0;
  const template = page.kind === "blank" ? page.template : undefined;
  useEffect(() => {
    const controller = new AbortController();
    const entry: NotePage = kind === "pdf" ? { id, kind, pageNumber } : { id, kind, width, height, template };
    source.get(entry, controller.signal).then(value => { setBase(value); })
      .catch(() => { if (!controller.signal.aborted) setStatus("プレビューなし"); });
    return () => controller.abort();
  }, [source, id, kind, pageNumber, width, height, template]);
  useEffect(() => {
    if (!base) return;
    const controller = new AbortController();
    // 描画途中のキャンバスを表示せず、完了したものだけ反映する。
    const buffer = window.document.createElement("canvas");
    paintThumbnailAnnotations(buffer, base, id, strokes, texts, tapes, images, controller.signal).then(() => {
      if (controller.signal.aborted || !canvas.current) return;
      const target = canvas.current;
      target.width = buffer.width; target.height = buffer.height;
      target.getContext("2d")?.drawImage(buffer, 0, 0); setStatus("");
    }).catch(() => {
      if (!controller.signal.aborted && canvas.current) {
        // 書き込みのプレビューに失敗しても元ページとページ移動は使える。
        canvas.current.width = base.canvas.width; canvas.current.height = base.canvas.height;
        canvas.current.getContext("2d")?.drawImage(base.canvas, 0, 0);
        setStatus("書き込みの表示失敗");
      }
    });
    return () => controller.abort();
  }, [base, id, strokes, texts, tapes, images]);
  return <span className="page-thumbnail-preview" aria-hidden="true">
    <canvas ref={canvas} hidden={!base} />
    {status && <span className="page-thumbnail-status">{status}</span>}
  </span>;
}

function ThumbnailList({ document, pages, currentPage, disabled, strokesByPage, textsByPage, tapesByPage, images, onNavigate }: Props) {
  const [source] = useState(() => createThumbnailQueue(async (page, signal) => {
    // ページ表示・入力を優先し、一覧の連続生成でメインスレッドを占有しない。
    await new Promise(resolve => setTimeout(resolve, 30));
    return renderPageThumbnail(document, page, signal);
  }));
  const scroll = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 0 });
  useEffect(() => {
    const element = scroll.current; if (!element) return;
    const update = () => setView({ top: element.scrollTop, height: element.clientHeight });
    const observer = new ResizeObserver(update); observer.observe(element); update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = scroll.current; if (!element) return;
    const top = (currentPage - 1) * THUMBNAIL_ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + THUMBNAIL_ROW_HEIGHT > element.scrollTop + element.clientHeight)
      element.scrollTop = top + THUMBNAIL_ROW_HEIGHT - element.clientHeight;
    setView({ top: element.scrollTop, height: element.clientHeight });
  }, [currentPage, pages.length]);
  const { start, end } = thumbnailWindow(view.top, view.height, pages.length);
  return <div ref={scroll} id="page-thumbnail-list" className="page-thumbnail-scroll" role="navigation" aria-label="ページ一覧"
    onScroll={event => setView({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
    <div className="page-thumbnail-items" style={{ height: pages.length * THUMBNAIL_ROW_HEIGHT }}>
      {pages.slice(start, end).map((page, offset) => {
        const number = start + offset + 1;
        return <button key={page.id} type="button" className="page-thumbnail-item" style={{ top: (number - 1) * THUMBNAIL_ROW_HEIGHT }}
          aria-label={`${number}ページを表示`} aria-current={number === currentPage ? "page" : undefined} disabled={disabled}
          onClick={() => { if (!disabled) onNavigate(number); }}>
          <Preview page={page} source={source} strokes={strokesByPage[page.id] ?? EMPTY_STROKES}
            texts={textsByPage[page.id] ?? EMPTY_TEXTS} tapes={tapesByPage?.[page.id] ?? EMPTY_TAPES} images={images} />
          <span className="page-thumbnail-number">{number}</span>
        </button>;
      })}
    </div>
  </div>;
}

export function PageThumbnails(props: Props) {
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const media = window.matchMedia(THUMBNAIL_MEDIA_QUERY);
    const update = () => setDesktop(media.matches); update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  if (!desktop) return null;
  return <aside className="page-thumbnails" data-open={open} aria-label="ページのプレビュー">
    <button type="button" className="page-thumbnails-toggle btn btn-ghost btn-sm" aria-label={open ? "ページ一覧を閉じる" : "ページ一覧を開く"}
      aria-expanded={open} aria-controls="page-thumbnail-list" onClick={() => setOpen(value => !value)}>
      <EditorIcon name={open ? "previous-page" : "next-page"} /><span>ページ</span>
    </button>
    {open && <ThumbnailList {...props} />}
  </aside>;
}
