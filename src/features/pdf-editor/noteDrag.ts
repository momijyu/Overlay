import type { NoteLibrary } from "./types";
import { hasFolderNameConflict } from "./noteTree";

export const NOTE_DRAG_TYPE = "application/x-overlay-item";
export type NoteDragItem = { kind: "note" | "folder"; id: string };

export function noteItemKey(item: NoteDragItem): string {
  return `${item.kind}:${item.id}`;
}

export function libraryItems(library: NoteLibrary): NoteDragItem[] {
  return [...library.folders.map(({ id }) => ({ kind: "folder" as const, id })),
    ...library.notes.map(({ id }) => ({ kind: "note" as const, id }))];
}

// 親と子を同時に選んだ場合、親だけを移動して中の階層を維持する。
export function selectedMoveRoots(items: NoteDragItem[], library: NoteLibrary): NoteDragItem[] {
  const keys = new Set(items.map(noteItemKey));
  return items.filter((item, index) => {
    if (items.findIndex((other) => noteItemKey(other) === noteItemKey(item)) !== index) return false;
    let parent = item.kind === "folder"
      ? library.folders.find((folder) => folder.id === item.id)?.parentId
      : library.notes.find((note) => note.id === item.id)?.folderId;
    const visited = new Set<string>();
    while (parent) {
      if (keys.has(`folder:${parent}`)) return false;
      if (visited.has(parent)) return false;
      visited.add(parent);
      parent = library.folders.find((folder) => folder.id === parent)?.parentId;
    }
    return true;
  });
}

// UIと保存処理で同じ判定を使う。1件でも不正なら全件を移動しない。
export function canMoveItems(items: NoteDragItem[], parentId: string | null, library: NoteLibrary): boolean {
  const existing = new Set(libraryItems(library).map(noteItemKey));
  if (!items.length || items.some((item) => !existing.has(noteItemKey(item)))) return false;
  const roots = selectedMoveRoots(items, library);
  let changed = false;
  const names = new Set<string>();
  for (const item of roots) {
    const folder = item.kind === "folder" ? library.folders.find((entry) => entry.id === item.id) : undefined;
    const currentParent = folder ? folder.parentId : library.notes.find((note) => note.id === item.id)?.folderId;
    if (folder) {
      const name = folder.name.trim().toLowerCase();
      if (names.has(name)) return false;
      names.add(name);
    }
    if (currentParent === parentId) continue;
    if (!canMoveItem(item, parentId, library)) return false;
    changed = true;
  }
  return changed;
}

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

// 表示中の一覧から移動先を確認する。保存処理でも改めて検証する。
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
  if (hasFolderNameConflict(folder.name, parentId, library, folder.id)) return false;
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
