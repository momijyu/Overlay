import type { SavedNoteSummary } from "./types";

// 一覧用ストアへPDF・線・文章・将来の編集情報を紛れ込ませない。
// DBの旧版移行と、通常の保存・整理で同じ項目だけを取り出す。
export function toLocalNoteSummary(note: SavedNoteSummary): SavedNoteSummary {
  const { id, title, fileName, folderId, updatedAt } = note;
  return { id, title, fileName, folderId, updatedAt };
}
