"use client";

import { useEffect, useRef, useState } from "react";
import type { StickyPageLink } from "../types";

export const STICKY_GUTTER_QUERY = "(min-width: 92rem) and (hover: hover) and (pointer: fine)";
export const STICKY_HOVER_QUERY = "(hover: hover) and (pointer: fine)";

export function CurrentStickyNotes({ entries, currentPageId, disabled, onNavigate }: {
  entries: StickyPageLink[]; currentPageId: number; disabled: boolean;
  onNavigate: (pageId: number, textId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const hoverOpened = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelClose() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }
  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
  }, []);
  function close(restoreFocus = true) {
    cancelClose();
    hoverOpened.current = false;
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }
  return <aside className="current-sticky-nav" data-open={open} aria-label="この資料の付箋"
    onPointerEnter={(event) => {
      if (event.pointerType === "mouse" && open) cancelClose();
    }}
    onPointerLeave={(event) => {
      if (event.pointerType !== "mouse" || !hoverOpened.current) return;
      cancelClose();
      closeTimer.current = setTimeout(() => close(false), 200);
    }}
    onFocusCapture={(event) => {
      // キーボードで操作中の一覧は、マウスが離れても閉じない。
      if (event.target.matches(":focus-visible")) { cancelClose(); hoverOpened.current = false; }
    }}
    onKeyDown={(event) => {
      if (open && event.key === "Escape") { event.stopPropagation(); close(); }
    }}>
    <div className="current-sticky-edge" aria-hidden="true" onPointerEnter={(event) => {
      if (event.pointerType !== "mouse" || !window.matchMedia(STICKY_HOVER_QUERY).matches) return;
      cancelClose();
      if (!open) { hoverOpened.current = true; setOpen(true); }
    }} />
    <button ref={trigger} type="button" className="current-sticky-trigger btn btn-sm min-h-11 min-w-11 shadow-sm"
      aria-expanded={open} aria-controls="current-sticky-list"
      onClick={() => { cancelClose(); hoverOpened.current = false; setOpen((value) => !value); }}>付箋</button>
    <section id="current-sticky-list" aria-hidden={!open} inert={!open}
      className="current-sticky-panel rounded-box border border-base-300 bg-base-100 shadow-md">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-base-300 px-3 py-2">
        <h2 className="text-sm font-semibold">この資料の付箋</h2>
        <button type="button" className="btn btn-square btn-ghost btn-sm min-h-11 min-w-11" aria-label="付箋一覧を閉じる" onClick={() => close()}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-2">
        {entries.length === 0 && <p className="p-2 text-sm text-base-content/60">付箋はありません。</p>}
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => <li key={`${entry.pageId}:${entry.textId}`}>
            <button type="button" disabled={disabled} title={entry.label}
              className="flex min-h-11 w-full items-start gap-2 rounded-field px-2 py-2 text-left text-sm hover:bg-base-200 disabled:opacity-50"
              aria-current={currentPageId === entry.pageId ? "page" : undefined}
              onClick={() => {
                if (disabled) return;
                onNavigate(entry.pageId, entry.textId);
                if (!window.matchMedia(STICKY_GUTTER_QUERY).matches) close();
              }}>
              <span className="shrink-0 tabular-nums">{entry.pageNumber}ページ</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{entry.label}</span>
            </button>
          </li>)}
        </ul>
      </div>
    </section>
  </aside>;
}
