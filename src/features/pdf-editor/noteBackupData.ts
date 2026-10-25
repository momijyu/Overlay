import { readStrokes } from "./strokeData";
import { readTextNotes } from "./textData";
import type { NoteFolder, PenStroke, TextNotesByPage } from "./types";

// 保存領域全体の上限ではなく、1回のファイル読み込みで扱う量の安全上限。
export const BACKUP_LIMITS = { bytes: 256 * 1024 * 1024, jsonBytes: 16 * 1024 * 1024,
  notes: 200, folders: 1000, points: 500_000, texts: 10_000, depth: 100 } as const;

export type BackupNote = {
  id: string; title: string; fileName: string; folderId: string | null;
  strokesByPage: Record<number, PenStroke[]>; textsByPage: TextNotesByPage; pdf: Blob;
};
export type NoteBackup = {
  schemaVersion: 1 | 2; kind: "note" | "folder" | "selection"; name: string;
  folders: NoteFolder[]; notes: BackupNote[];
};

function invalid(): never { throw new Error("バックアップの内容が不正です。"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function name(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || [...value].length > max || /\p{Cc}/u.test(value)) invalid();
  return value;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) invalid();
  return value;
}

// ファイル由来の値だけでなく、DB由来の書き出し内容にも同じ検証を適用する。
export function readNoteBackup(value: unknown): NoteBackup {
  const data = object(value);
  if (data.schemaVersion !== 1 && data.schemaVersion !== 2) throw new Error("このバックアップの形式バージョンには対応していません。");
  if (data.kind !== "note" && data.kind !== "folder" && data.kind !== "selection") invalid();
  if ((data.kind === "selection") !== (data.schemaVersion === 2)) invalid();
  if (!Array.isArray(data.folders) || !Array.isArray(data.notes)
    || data.folders.length > BACKUP_LIMITS.folders || data.notes.length > BACKUP_LIMITS.notes) invalid();
  const folders = data.folders.map((value) => {
    const folder = object(value);
    return { id: id(folder.id), name: name(folder.name, 80), parentId: folder.parentId === null ? null : id(folder.parentId) };
  });
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  if (folderMap.size !== folders.length) invalid();
  const siblingNames = new Set<string>();
  for (const folder of folders) {
    const key = JSON.stringify([folder.parentId, folder.name.trim().toLowerCase()]);
    // 異なる元フォルダから同名の根を選べる。復元時にだけ衝突を回避する。
    if (siblingNames.has(key) && !(data.kind === "selection" && folder.parentId === null)) invalid();
    siblingNames.add(key);
    let current: NoteFolder | undefined = folder;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current.id) || visited.size >= BACKUP_LIMITS.depth) invalid();
      visited.add(current.id);
      if (current.parentId === null) break;
      current = folderMap.get(current.parentId);
      if (!current) invalid();
    }
  }
  let bytes = 0, points = 0, texts = 0;
  const noteIds = new Set<string>();
  const notes = data.notes.map((value): BackupNote => {
    const note = object(value);
    const noteId = id(note.id);
    if (noteIds.has(noteId)) invalid();
    noteIds.add(noteId);
    const folderId = note.folderId === null ? null : id(note.folderId);
    if (folderId !== null && !folderMap.has(folderId)) invalid();
    if (!(note.pdf instanceof Blob) || note.pdf.size === 0) invalid();
    bytes += note.pdf.size;
    if (bytes > BACKUP_LIMITS.bytes) throw new Error("バックアップは合計256MiB以下に分けてください。");
    // 大量の座標を複製する前に件数を制限する。
    const rawStrokes = object(note.strokesByPage);
    for (const page of Object.values(rawStrokes)) {
      if (!Array.isArray(page)) invalid();
      for (const stroke of page) {
        const raw = object(stroke);
        if (!Array.isArray(raw.points)) invalid();
        points += raw.points.length;
        if (points > BACKUP_LIMITS.points) invalid();
      }
    }
    for (const page of Object.values(object(note.textsByPage ?? {}))) {
      if (!Array.isArray(page)) invalid();
      texts += page.length;
      if (texts > BACKUP_LIMITS.texts) invalid();
    }
    return { id: noteId, title: name(note.title, 120), fileName: name(note.fileName, 255), folderId,
      strokesByPage: readStrokes(rawStrokes), textsByPage: readTextNotes(note.textsByPage), pdf: note.pdf };
  });
  if (data.kind === "note" && (folders.length !== 0 || notes.length !== 1 || notes[0].folderId !== null)) invalid();
  if (data.kind === "folder" && (folders.filter((folder) => folder.parentId === null).length !== 1
    || notes.some((note) => note.folderId === null))) invalid();
  if (data.kind === "selection" && folders.length + notes.length === 0) invalid();
  return { schemaVersion: data.schemaVersion, kind: data.kind, name: name(data.name, 120), folders, notes };
}

export function backupDownloadName(value: string, extension: "overlay" | "zip" = "overlay"): string {
  const base = value.trim().replace(/\.(overlay|zip)$/i, "").replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").replace(/[. ]+$/, "");
  return `${base || "ノート"}.${extension}`;
}
