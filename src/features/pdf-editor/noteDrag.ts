import type { NoteLibrary } from "./types";

export const NOTE_DRAG_TYPE = "application/x-overlay-item";
export type NoteDragItem = { kind: "note" | "folder"; id: string };

export function readNoteDrag(value: string): NoteDragItem | null {
  try {
    const item: unknown = JSON.parse(value);
    if (!item || typeof item !== "object" || !("kind" in item) || !("id" in item)) return null;
    if ((item.kind !== "note" && item.kind !== "folder") || typeof item.id !== "string" || !item.id) return null;
    return { kind: item.kind, id: item.id };
  } catch {
    return null;
  }
}

// 表示中の一覧から移動先を確認する。保存先のSQLでも改めて検証する。
export function canMoveItem(item: NoteDragItem, parentId: string | null, library: NoteLibrary): boolean {
  if (!library.foldersEnabled) return false;
  const folders = new Map(library.folders.map((folder) => [folder.id, folder]));
  if (parentId !== null && !folders.has(parentId)) return false;
  if (item.kind === "note") {
    const note = library.notes.find((note) => note.id === item.id);
    return note !== undefined && note.folderId !== parentId;
  }
  const folder = folders.get(item.id);
  if (!folder || folder.parentId === parentId) return false;
  const visited = new Set<string>();
  let ancestorId = parentId;
  while (ancestorId !== null) {
    if (ancestorId === item.id || visited.has(ancestorId)) return false;
    visited.add(ancestorId);
    const ancestor = folders.get(ancestorId);
    if (!ancestor) return false;
    ancestorId = ancestor.parentId;
  }
  return true;
}
