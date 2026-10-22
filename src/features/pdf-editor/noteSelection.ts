import { libraryItems, noteItemKey, type NoteDragItem } from "./noteDrag";
import type { NoteLibrary } from "./types";

function subtreeKeys(item: NoteDragItem, library: NoteLibrary): Set<string> {
  const keys = new Set([noteItemKey(item)]);
  if (item.kind === "note") return keys;
  const folders = new Set([item.id]);
  const pending = [item.id];
  while (pending.length) {
    const parentId = pending.pop()!;
    for (const folder of library.folders) {
      if (folder.parentId !== parentId || folders.has(folder.id)) continue;
      folders.add(folder.id);
      keys.add(noteItemKey({ kind: "folder", id: folder.id }));
      pending.push(folder.id);
    }
  }
  for (const note of library.notes) {
    if (note.folderId !== null && folders.has(note.folderId)) keys.add(noteItemKey({ kind: "note", id: note.id }));
  }
  return keys;
}

export function toggleNotebookSelection(previous: Set<string>, item: NoteDragItem, library: NoteLibrary): Set<string> {
  const existing = new Set(libraryItems(library).map(noteItemKey));
  const next = new Set([...previous].filter((key) => existing.has(key)));
  const key = noteItemKey(item);
  if (!existing.has(key)) return next;
  const subtree = subtreeKeys(item, library);
  if (!next.has(key)) {
    // 閉じた階層も含め、フォルダの選択を見た目と操作対象で一致させる。
    for (const child of subtree) next.add(child);
  } else {
    for (const child of subtree) next.delete(child);
    // 一部を外したフォルダは選択状態にしない。ほかの兄弟のチェックは保持する。
    let parentId = item.kind === "folder"
      ? library.folders.find((folder) => folder.id === item.id)?.parentId
      : library.notes.find((note) => note.id === item.id)?.folderId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      next.delete(noteItemKey({ kind: "folder", id: parentId }));
      parentId = library.folders.find((folder) => folder.id === parentId)?.parentId;
    }
  }
  return next;
}

// 子を暗黙に追加せず、確認済みの選択だけでフォルダを削除できるか検証する。
export function checkedDeletion(items: NoteDragItem[], library: NoteLibrary): NoteDragItem[] {
  const existing = new Set(libraryItems(library).map(noteItemKey));
  const keys = new Set(items.map(noteItemKey));
  if (!keys.size || [...keys].some((key) => !existing.has(key))) {
    throw new Error("削除対象が変更されています。キャンセルして一覧を更新し、選び直してください。");
  }
  for (const folder of library.folders) {
    if (!keys.has(noteItemKey({ kind: "folder", id: folder.id }))) continue;
    if ([...subtreeKeys({ kind: "folder", id: folder.id }, library)].some((key) => !keys.has(key))) {
      throw new Error("フォルダの中身が選択内容と異なります。キャンセルして一覧を更新し、選び直してください。");
    }
  }
  return libraryItems(library).filter((item) => keys.has(noteItemKey(item)));
}
