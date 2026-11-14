import { checkPageBindings } from "./notePages";
import { readDriveImages, type DriveImages } from "./driveImages";
import { BACKUP_LIMITS, readNoteBackup, type NoteBackup } from "./noteBackupData";

export const DRIVE_NOTE_SUFFIX = ".overlay.json";
export const DRIVE_NOTE_FIELDS = "id,name,mimeType,ownedByMe,trashed,parents,appProperties,size,modifiedTime,version,sha256Checksum";
export type DriveOverwriteTarget = { note: DriveNoteSummary; version: string };
export type DriveNoteSummary = { id: string; title: string; updatedAt: string; containerId: string; noteKey: string; deviceId?: string };
export type DriveNoteManifest = {
  schemaVersion: 1 | 2 | 3 | 4 | 5 | 6; kind: "overlay-drive-note"; noteKey: string; title: string; fileName: string;
  sync?: { deviceId: string; generation: number; hash: string };
  pdfId: string; pdfBytes: number; strokesByPage: NoteBackup["notes"][number]["strokesByPage"];
  textsByPage: NoteBackup["notes"][number]["textsByPage"];
  tapesByPage?: import("./types").TapesByPage;
  images?: DriveImages;
  pages?: NoteBackup["notes"][number]["pages"];
  headingsByPage?: NoteBackup["notes"][number]["headingsByPage"];
};

export function driveObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Driveノートの形式が不正です。");
  return value as Record<string, unknown>;
}

export function driveId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) throw new Error("Driveノートの識別情報が不正です。");
  return value;
}

export function driveFile(value: unknown, role: "note" | "sync-note" | "note-container" | "pdf" | "image", rootId: string, noteKey?: string, parentId?: string) {
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
  const expectedType = role === "pdf" ? "application/pdf" : role === "note" || role === "sync-note" ? "application/json" : "application/vnd.google-apps.folder";
  if (role === "image" ? !["image/png", "image/jpeg"].includes(file.mimeType as string) : file.mimeType !== expectedType) throw new Error("Driveノートのファイル種類が一致しません。");
  return file;
}

export function driveNoteSummary(value: unknown, rootId: string): DriveNoteSummary {
  const auto = driveObject(driveObject(value).appProperties).overlayRole === "sync-note";
  const file = driveFile(value, auto ? "sync-note" : "note", rootId);
  if (typeof file.name !== "string" || !file.name.endsWith(DRIVE_NOTE_SUFFIX)) throw new Error("Driveノート名が不正です。");
  const title = file.name.slice(0, -DRIVE_NOTE_SUFFIX.length);
  if (!title.trim() || [...title].length > 120 || /\p{Cc}/u.test(title) || !Array.isArray(file.parents) || file.parents.length !== 1
    || typeof file.modifiedTime !== "string" || !Number.isFinite(Date.parse(file.modifiedTime))) throw new Error("Driveノートの一覧情報が不正です。");
  return { id: driveId(file.id), title, containerId: driveId(file.parents[0]),
    ...(auto ? { deviceId: driveId(driveObject(file.appProperties).overlayDeviceId) } : {}),
    noteKey: driveId(driveObject(file.appProperties).overlayNoteKey), updatedAt: file.modifiedTime };
}

export function singleDriveNote(input: unknown) {
  const backup = readNoteBackup(input);
  if (backup.kind !== "note") throw new Error("Driveへの新規保存はノート1件ずつ行ってください。");
  return backup.notes[0];
}

export function readDriveManifest(value: unknown, expectedKey: string): DriveNoteManifest {
  const data = driveObject(value);
  if ((data.schemaVersion !== 1 && data.schemaVersion !== 2 && data.schemaVersion !== 3 && data.schemaVersion !== 4 && data.schemaVersion !== 5 && data.schemaVersion !== 6) || data.kind !== "overlay-drive-note") throw new Error("このDriveノートの形式バージョンには対応していません。");
  if (data.images !== undefined && data.schemaVersion < 5) throw new Error("画像の保存形式が不正です。");
  if (data.tapesByPage !== undefined && data.schemaVersion !== 6) throw new Error("目隠しテープの保存形式が不正です。");
  const images = readDriveImages(data.images);
  let sync: DriveNoteManifest["sync"];
  if (data.schemaVersion === 4 || (data.schemaVersion === 5 || data.schemaVersion === 6) && data.sync !== undefined) {
    const value = driveObject(data.sync);
    if (!Number.isSafeInteger(value.generation) || (value.generation as number) < 1 || typeof value.hash !== "string" || !/^[a-f0-9]{64}$/.test(value.hash)) throw new Error("Driveノートの自動保存情報が不正です。");
    sync = { deviceId: driveId(value.deviceId), generation: value.generation as number, hash: value.hash };
  } else if (data.sync !== undefined) throw new Error("Driveノートの自動保存形式が不正です。");
  if (data.schemaVersion === 3 && data.headingsByPage === undefined) throw new Error("Driveノートの見出し情報がありません。");
  if (data.schemaVersion < 3 && data.headingsByPage !== undefined) throw new Error("Driveノートの見出し形式が不正です。");
  if (data.schemaVersion === 2 && data.pages === undefined) throw new Error("Driveノートのページ構成がありません。");
  if (driveId(data.noteKey) !== expectedKey || !Number.isSafeInteger(data.pdfBytes)
    || (data.pdfBytes as number) <= 0 || (data.pdfBytes as number) > BACKUP_LIMITS.bytes) throw new Error("DriveノートのPDF情報が不正です。");
  // ダウンロード前に、共通検証で文章・線・件数・名前を確認する。PDFは後から実データで再検証する。
  if (data.schemaVersion === 1 && data.pages !== undefined) throw new Error("Driveノートのページ形式が不正です。");
  const checked = singleDriveNote({ schemaVersion: data.tapesByPage !== undefined ? 6 : data.headingsByPage !== undefined ? 4 : data.pages !== undefined ? 3 : 1, kind: "note", name: data.title, folders: [], notes: [{
    id: data.noteKey, title: data.title, fileName: data.fileName, folderId: null,
    tapesByPage: data.tapesByPage, headingsByPage: data.headingsByPage, pages: data.pages, strokesByPage: data.strokesByPage, textsByPage: data.textsByPage, pdf: new Blob(["%PDF-placeholder"]),
  }] });
  checkPageBindings(checked.pages, [images?.byPage ?? {}]);
  return { ...(checked.tapesByPage ? { tapesByPage: checked.tapesByPage } : {}), schemaVersion: data.schemaVersion, ...(images ? { images } : {}), ...(sync ? { sync } : {}), kind: "overlay-drive-note", noteKey: expectedKey, title: checked.title, fileName: checked.fileName,
    ...(checked.pages ? { pages: checked.pages } : {}), ...(checked.headingsByPage ? { headingsByPage: checked.headingsByPage } : {}), pdfId: driveId(data.pdfId), pdfBytes: data.pdfBytes as number, strokesByPage: checked.strokesByPage, textsByPage: checked.textsByPage };
}
