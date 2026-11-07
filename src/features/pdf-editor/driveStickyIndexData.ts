import { driveId, driveObject } from "./googleDriveNoteData";
import type { LibrarySource } from "./driveLibraryData";
import { BACKUP_LIMITS } from "./noteBackupData";
import type { StickyPageLink } from "./types";

// 最大1万付箋の先頭行（各120文字）も切り捨てない。PDF・線・座標は含めない。
export const STICKY_INDEX_BYTES = 8 * 1024 * 1024;
export class DriveStickyIndexError extends Error {
  constructor(cause: unknown) {
    super(`付箋一覧を更新できません。ノート本文の自動保存は継続します。${cause instanceof Error ? cause.message : "Drive一覧から再試行してください。"}`, { cause });
    this.name = "DriveStickyIndexError";
  }
}
export type DriveStickyIndex = {
  schemaVersion: 1; kind: "overlay-sticky-index";
  logicalId: string; sourceId: string; noteKey: string; deviceId: string;
  generation: number; entries: StickyPageLink[];
};
export type DriveStickyCache = {
  sourceId: string; fileId: string; checksum: string; generation: number;
  entries: StickyPageLink[];
};

export function readStickyEntries(input: unknown): StickyPageLink[] {
  if (!Array.isArray(input) || input.length > BACKUP_LIMITS.texts) throw new Error("Driveの付箋索引の件数が不正です。");
  const ids = new Set<string>();
  return input.map((value) => {
    const entry = driveObject(value);
    const { pageId, pageNumber, textId, label } = entry;
    if (!Number.isSafeInteger(pageId) || (pageId as number) < 1 || !Number.isSafeInteger(pageNumber) || (pageNumber as number) < 1
      || typeof textId !== "string" || !textId || textId.length > 100
      || typeof label !== "string" || !label.trim() || [...label].length > 120 || /\p{Cc}/u.test(label)) {
      throw new Error("Driveの付箋索引の形式が不正です。");
    }
    const key = `${pageId}:${textId}`;
    if (ids.has(key)) throw new Error("Driveの付箋索引に重複があります。");
    ids.add(key);
    return { pageId: pageId as number, pageNumber: pageNumber as number, textId, label };
  });
}

export function readDriveStickyIndex(input: unknown, source: LibrarySource): DriveStickyIndex {
  const value = driveObject(input);
  if (value.schemaVersion !== 1 || value.kind !== "overlay-sticky-index"
    || driveId(value.logicalId) !== source.logicalId || driveId(value.sourceId) !== source.noteId
    || driveId(value.noteKey) !== source.noteKey || driveId(value.deviceId) !== source.deviceId
    || !Number.isSafeInteger(value.generation) || (value.generation as number) < 1) {
    throw new Error("Driveの付箋索引の参照先が一致しません。");
  }
  return { schemaVersion: 1, kind: "overlay-sticky-index", logicalId: source.logicalId, sourceId: source.noteId,
    noteKey: source.noteKey, deviceId: source.deviceId, generation: value.generation as number, entries: readStickyEntries(value.entries) };
}
