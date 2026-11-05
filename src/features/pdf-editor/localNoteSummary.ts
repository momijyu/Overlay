import { createStickyOutline } from "./stickyOutline";
import type { NotePage, SavedNoteSummary, TextNotesByPage } from "./types";

// 一覧には基本情報と付箋への参照だけを含め、PDF・線・文章本文を持ち込まない。
// DBの旧版移行と、通常の保存・整理で同じ項目だけを取り出す。
export function toLocalNoteSummary(note: SavedNoteSummary & { textsByPage?: TextNotesByPage; pages?: NotePage[] }): SavedNoteSummary {
  const { id, title, fileName, folderId, updatedAt } = note;
  const stickyNotes = createStickyOutline(note.textsByPage, note.pages);
  return { id, title, fileName, folderId, updatedAt, ...(stickyNotes.length ? { stickyNotes } : {}) };
}
