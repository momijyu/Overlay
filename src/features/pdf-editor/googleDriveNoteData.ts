import { BACKUP_LIMITS, readNoteBackup, type NoteBackup } from "./noteBackupData";

export const DRIVE_NOTE_SUFFIX = ".overlay.json";
export const DRIVE_NOTE_FIELDS = "id,name,mimeType,ownedByMe,trashed,parents,appProperties,size,modifiedTime,version,sha256Checksum";
export type DriveOverwriteTarget = { note: DriveNoteSummary; version: string };
export type DriveNoteSummary = { id: string; title: string; updatedAt: string; containerId: string; noteKey: string };
export type DriveNoteManifest = {
  schemaVersion: 1; kind: "overlay-drive-note"; noteKey: string; title: string; fileName: string;
  pdfId: string; pdfBytes: number; strokesByPage: NoteBackup["notes"][number]["strokesByPage"];
  textsByPage: NoteBackup["notes"][number]["textsByPage"];
};

export function driveObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Driveノートの形式が不正です。");
  return value as Record<string, unknown>;
}

export function driveId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error("Driveノートの識別情報が不正です。");
  return value;
}

export function driveFile(value: unknown, role: "note" | "note-container" | "pdf", rootId: string, noteKey?: string, parentId?: string) {
  const file = driveObject(value);
  driveId(file.id);
  const properties = driveObject(file.appProperties);
  if (file.ownedByMe !== true || file.trashed !== false || properties.overlayApp !== "overlay"
    || properties.overlaySchema !== "1" || properties.overlayRole !== role || properties.overlayRootId !== rootId
    || (noteKey !== undefined && properties.overlayNoteKey !== noteKey)
    || (parentId !== undefined && (!Array.isArray(file.parents) || file.parents.length !== 1 || file.parents[0] !== parentId))) {
    throw new Error("Driveノートの所有者・保存場所・形式を確認できませんでした。");
  }
  driveId(properties.overlayNoteKey);
  const expectedType = role === "pdf" ? "application/pdf" : role === "note" ? "application/json" : "application/vnd.google-apps.folder";
  if (file.mimeType !== expectedType) throw new Error("Driveノートのファイル種類が一致しません。");
  return file;
}

export function driveNoteSummary(value: unknown, rootId: string): DriveNoteSummary {
  const file = driveFile(value, "note", rootId);
  if (typeof file.name !== "string" || !file.name.endsWith(DRIVE_NOTE_SUFFIX)) throw new Error("Driveノート名が不正です。");
  const title = file.name.slice(0, -DRIVE_NOTE_SUFFIX.length);
  if (!title.trim() || [...title].length > 120 || /\p{Cc}/u.test(title) || !Array.isArray(file.parents) || file.parents.length !== 1
    || typeof file.modifiedTime !== "string" || !Number.isFinite(Date.parse(file.modifiedTime))) throw new Error("Driveノートの一覧情報が不正です。");
  return { id: driveId(file.id), title, containerId: driveId(file.parents[0]),
    noteKey: driveId(driveObject(file.appProperties).overlayNoteKey), updatedAt: file.modifiedTime };
}

export function singleDriveNote(input: unknown) {
  const backup = readNoteBackup(input);
  if (backup.kind !== "note") throw new Error("Driveへの新規保存はノート1件ずつ行ってください。");
  return backup.notes[0];
}

export function readDriveManifest(value: unknown, expectedKey: string): DriveNoteManifest {
  const data = driveObject(value);
  if (data.schemaVersion !== 1 || data.kind !== "overlay-drive-note") throw new Error("このDriveノートの形式バージョンには対応していません。");
  if (driveId(data.noteKey) !== expectedKey || !Number.isSafeInteger(data.pdfBytes)
    || (data.pdfBytes as number) <= 0 || (data.pdfBytes as number) > BACKUP_LIMITS.bytes) throw new Error("DriveノートのPDF情報が不正です。");
  // ダウンロード前に、共通検証で文章・線・件数・名前を確認する。PDFは後から実データで再検証する。
  const checked = singleDriveNote({ schemaVersion: 1, kind: "note", name: data.title, folders: [], notes: [{
    id: data.noteKey, title: data.title, fileName: data.fileName, folderId: null,
    strokesByPage: data.strokesByPage, textsByPage: data.textsByPage, pdf: new Blob(["%PDF-placeholder"]),
  }] });
  return { schemaVersion: 1, kind: "overlay-drive-note", noteKey: expectedKey, title: checked.title, fileName: checked.fileName,
    pdfId: driveId(data.pdfId), pdfBytes: data.pdfBytes as number, strokesByPage: checked.strokesByPage, textsByPage: checked.textsByPage };
}
