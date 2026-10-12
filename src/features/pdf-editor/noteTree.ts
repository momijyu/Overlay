import type { NoteFolder, NoteLibrary, SavedNoteSummary } from "./types";

// DBのlower(name)制約に合わせた事前確認。別タブの変更はDBでも検証する。
export function hasFolderNameConflict(name: string, parentId: string | null, library: NoteLibrary, exceptId?: string): boolean {
  const normalized = name.trim().toLowerCase();
  return library.folders.some((folder) => folder.id !== exceptId && folder.parentId === parentId
    && folder.name.toLowerCase() === normalized);
}

export function canDeleteEmptyFolder(folderId: string, library: NoteLibrary): boolean {
  return library.foldersEnabled && library.folders.some((folder) => folder.id === folderId)
    && !library.folders.some((folder) => folder.parentId === folderId)
    && !library.notes.some((note) => note.folderId === folderId);
}

export type NoteTreeFolder = NoteFolder & {
  folders: NoteTreeFolder[];
  notes: SavedNoteSummary[];
};
export type NoteTree = {
  folders: NoteTreeFolder[];
  notes: SavedNoteSummary[];
};

// DBの親IDを使ってツリーを作る。PDFや線データをここへコピーしない。
export function buildNoteTree(folders: NoteFolder[], notes: SavedNoteSummary[]): NoteTree {
  const nodes = new Map<string, NoteTreeFolder>();
  for (const folder of folders) {
    if (nodes.has(folder.id)) throw new Error("フォルダ情報が重複しています。");
    nodes.set(folder.id, { ...folder, folders: [], notes: [] });
  }
  const root: NoteTree = { folders: [], notes: [] };
  for (const folder of nodes.values()) {
    const ancestors = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId) {
      if (ancestors.has(parentId)) throw new Error("フォルダの親子関係が循環しています。");
      ancestors.add(parentId);
      parentId = nodes.get(parentId)?.parentId ?? null;
    }
    const parent = folder.parentId ? nodes.get(folder.parentId) : null;
    // 不整合がある場合も、項目を隠してしまわず最上位へ表示する。
    (parent ?? root).folders.push(folder);
  }
  for (const note of notes) {
    const parent = note.folderId ? nodes.get(note.folderId) : null;
    (parent ?? root).notes.push(note);
  }
  function sortTree(node: NoteTree) {
    node.folders.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    node.notes.sort((a, b) => a.title.localeCompare(b.title, "ja"));
    node.folders.forEach(sortTree);
  }
  sortTree(root);
  return root;
}

export function folderChoices(tree: NoteTree): { id: string; path: string }[] {
  const choices: { id: string; path: string }[] = [];
  function visit(node: NoteTree, prefix: string) {
    for (const folder of node.folders) {
      const path = prefix ? `${prefix} / ${folder.name}` : folder.name;
      choices.push({ id: folder.id, path });
      visit(folder, path);
    }
  }
  visit(tree, "");
  return choices;
}
