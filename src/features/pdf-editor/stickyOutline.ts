import type { NotePage, SavedNoteSummary, StickyPageLink, TextNotesByPage } from "./types";

// 本文・PDF・座標を複製せず、ページ移動に必要なIDと短い先頭行だけを持つ。
export function createStickyOutline(texts: TextNotesByPage | undefined, pages?: NotePage[]): StickyPageLink[] {
  const order = new Map(pages?.map((page, index) => [page.id, index + 1]));
  return Object.entries(texts ?? {}).flatMap(([key, notes]) => {
    const pageId = Number(key);
    if (!Number.isSafeInteger(pageId) || pageId < 1 || !Array.isArray(notes)) return [];
    const pageNumber = pages ? order.get(pageId) : pageId;
    if (!pageNumber) return [];
    return notes.flatMap((note) => {
      if (!note || note.kind !== "sticky" || typeof note.id !== "string" || !note.id || typeof note.text !== "string") return [];
      const firstLine = note.text.split(/\r?\n/u).find((line) => line.trim())?.trim() ?? "";
      if (!firstLine) return [];
      return [{ pageId, pageNumber, textId: note.id, label: [...firstLine].slice(0, 120).join("") }];
    });
  }).sort((a, b) => a.pageNumber - b.pageNumber);
}

export type CurrentStickyOutline = { id: string | null; title: string; entries: StickyPageLink[] };
export type StickyOutlineGroup = { note: SavedNoteSummary | null; title: string; entries: StickyPageLink[] };

export function stickyOutlineGroups(notes: SavedNoteSummary[], current?: CurrentStickyOutline): StickyOutlineGroup[] {
  const others = notes.filter((note) => !current || note.id !== current.id)
    .filter((note) => note.stickyNotes?.length)
    .map((note) => ({ note, title: note.title, entries: note.stickyNotes! }));
  if (!current?.entries.length) return others;
  return [{ note: notes.find((note) => note.id === current.id) ?? null, title: current.title, entries: current.entries }, ...others];
}

export function stickyDestination(pages: NotePage[], texts: TextNotesByPage | undefined, pageId: number, textId: string): number {
  const index = pages.findIndex((page) => page.id === pageId);
  if (index < 0 || !texts?.[pageId]?.some((text) => text.kind === "sticky" && text.id === textId)) {
    throw new Error("この付箋は削除または変更されています。一覧を更新してください。");
  }
  return index + 1;
}
