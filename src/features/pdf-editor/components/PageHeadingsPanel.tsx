"use client";

import { useState } from "react";
import { MAX_HEADING_LENGTH, normalizeHeading } from "../pageHeadings";
import type { HeadingsByPage, NotePage } from "../types";

export function PageHeadingsPanel({ pages, headings, currentPageId, disabled, onChange, onNavigate }: {
  pages: NotePage[]; headings: HeadingsByPage; currentPageId: number; disabled: boolean;
  onChange: (pageId: number, heading: string) => void; onNavigate: (pageId: number) => void;
}) {
  const currentIndex = pages.findIndex((page) => page.id === currentPageId);
  const entries = pages.flatMap((page, index) => headings[page.id] ? [{ pageId: page.id, number: index + 1, heading: headings[page.id] }] : []);
  return <details className="mx-4 mb-3 rounded-box border border-base-300 bg-base-100" aria-label="ページ見出し">
    <summary className="cursor-pointer px-3 py-3 text-sm font-semibold">ページ見出し</summary>
    <div className="border-t border-base-300 p-3">
      {currentIndex >= 0 && <PageHeadingEditor key={`${currentPageId}-${headings[currentPageId] ?? ""}`}
        value={headings[currentPageId] ?? ""} pageNumber={currentIndex + 1} disabled={disabled}
        onApply={(heading) => onChange(currentPageId, heading)} />}
      {entries.length ? <ol className="mt-3 flex flex-col gap-1" aria-label="見出し一覧">
        {entries.map((entry) => <li key={entry.pageId}>
          <button type="button" className={`flex min-h-11 w-full items-start gap-2 rounded-field px-2 py-2 text-left text-sm hover:bg-base-200 ${entry.pageId === currentPageId ? "bg-base-300" : ""}`}
            disabled={disabled} aria-current={entry.pageId === currentPageId ? "page" : undefined} title={entry.heading}
            onClick={() => { if (!disabled) onNavigate(entry.pageId); }}>
            <span className="w-8 shrink-0 tabular-nums">{entry.number}</span><span className="min-w-0 break-words [overflow-wrap:anywhere]">{entry.heading}</span>
          </button>
        </li>)}
      </ol> : <p className="mt-3 text-sm text-base-content/60">見出しはありません。</p>}
    </div>
  </details>;
}

export function PageHeadingEditor({ value, pageNumber, disabled, onApply }: {
  value: string; pageNumber: number; disabled: boolean; onApply: (heading: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  let error: string | null = null;
  let normalized = "";
  try { normalized = normalizeHeading(draft); } catch (failure) { error = (failure as Error).message; }
  const changed = normalized !== value;
  return <form onSubmit={(event) => { event.preventDefault(); if (!disabled && !error && changed) onApply(normalized); }}>
    <label className="flex flex-col gap-2 text-sm">
      <span>{pageNumber}ページの見出し</span>
      <input type="text" className="input input-sm w-full" value={draft} placeholder="見出しを入力" maxLength={MAX_HEADING_LENGTH * 2}
        disabled={disabled} aria-invalid={!!error}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} />
    </label>
    {error && <p role="alert" className="mt-2 text-xs text-error">{error}</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="submit" className="btn btn-sm" disabled={disabled || !!error || !changed}>適用</button>
      <button type="button" className="btn btn-sm" disabled={disabled || draft === value} onClick={() => setDraft(value)}>キャンセル</button>
      {!!value && <button type="button" className="btn btn-sm text-error" disabled={disabled}
        onClick={() => { if (!disabled) onApply(""); }}>見出しを削除</button>}
    </div>
  </form>;
}
