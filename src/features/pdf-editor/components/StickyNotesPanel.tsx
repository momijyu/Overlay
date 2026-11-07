"use client";

import { stickyOutlineGroups, type CurrentStickyOutline } from "../stickyOutline";
import type { SavedNoteSummary } from "../types";

export function StickyNotesPanel({ notes, current, currentPageId, disabled, onNavigate }: {
  notes: SavedNoteSummary[]; current?: CurrentStickyOutline; currentPageId?: number; disabled: boolean;
  onNavigate: (note: SavedNoteSummary | null, pageId: number, textId: string, sourceId?: string) => void;
}) {
  const groups = stickyOutlineGroups(notes, current);
  const pending = notes.some((note) => note.stickyNotesPending);
  return <details className="min-w-0 rounded-box border border-base-300" aria-label="付箋一覧">
    <summary className="cursor-pointer px-3 py-3 text-sm font-semibold">付箋一覧</summary>
    <div className="max-h-72 overflow-y-auto border-t border-base-300 p-2">
      {groups.length === 0 && !pending && <p className="p-2 text-sm text-base-content/60">付箋はありません。</p>}
      {pending && <p className="p-2 text-sm text-base-content/60" role="status">付箋情報が未取得の資料があります。</p>}
      {groups.map((group) => {
        const versions = new Map([...new Set(group.entries.map((e) => e.sourceId))].map((id, index) => [id, index + 1]));
        return <section key={group.note?.id ?? "current"} className="mb-2 min-w-0">
        <h3 className="truncate px-2 py-1 text-sm font-semibold" title={group.title}>{group.title}</h3>
        <ul className="flex flex-col gap-1">
          {group.entries.map((entry) => <li key={`${entry.sourceId ?? "local"}:${entry.pageId}:${entry.textId}`}>
            <button type="button" className="flex min-h-11 w-full items-start gap-2 rounded-field px-2 py-2 text-left text-sm hover:bg-base-200"
              disabled={disabled} title={entry.label}
              aria-current={current && (group.note?.id ?? null) === current.id && currentPageId === entry.pageId ? "page" : undefined}
              onClick={() => { if (!disabled) {
                if (entry.sourceId) onNavigate(group.note, entry.pageId, entry.textId, entry.sourceId);
                else onNavigate(group.note, entry.pageId, entry.textId);
              } }}>
              <span className="shrink-0 tabular-nums">{entry.pageNumber}ページ</span>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{entry.label}</span>
              {entry.sourceId && versions.size > 1 && <span className="ml-auto shrink-0 text-xs text-base-content/60">
                版{versions.get(entry.sourceId)}
              </span>}
            </button>
          </li>)}
        </ul>
      </section>; })}
    </div>
  </details>;
}
