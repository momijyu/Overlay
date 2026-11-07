import type { LibraryScope, LibrarySource } from "./driveLibraryData";
import type { DriveNoteAccess } from "./googleDriveNotes";
import { DRIVE_NOTE_FIELDS, driveNoteSummary, driveObject } from "./googleDriveNoteData";
import type { SourceVersion } from "./driveVersionData";

export function checkedDriveVersion(value: unknown, scope: LibraryScope, source: LibrarySource) {
  const metadata = driveObject(value); const note = driveNoteSummary(metadata, scope.rootId);
  if (note.id !== source.noteId || note.noteKey !== source.noteKey || note.deviceId !== source.deviceId || note.containerId !== source.containerId
    || typeof metadata.version !== "string" || !/^\d{1,30}$/.test(metadata.version)
    || metadata.sha256Checksum !== undefined && (typeof metadata.sha256Checksum !== "string" || !/^[a-f0-9]{64}$/.test(metadata.sha256Checksum))) throw new Error("Driveの編集版を確認できませんでした。");
  return { source: { ...source, updatedAt: note.updatedAt }, version: { sourceId: source.noteId,
    version: metadata.version, ...(metadata.sha256Checksum ? { checksum: metadata.sha256Checksum as string } : {}) } satisfies SourceVersion, metadata };
}

// 内容をダウンロードせずに各保存先の確認情報・保存日時を取得する。
export async function readDriveVersions(access: DriveNoteAccess, scope: LibraryScope, sources: LibrarySource[]) {
  if (sources.length > 100) throw new Error("編集版の件数が確認上限を超えています。");
  const result: { source: LibrarySource; version: SourceVersion; metadata: Record<string, unknown> }[] = [];
  let offset = 0;
  await Promise.all(Array.from({ length: Math.min(4, sources.length) }, async () => {
    for (;;) {
      const source = sources[offset++]; if (!source) return;
      result.push(checkedDriveVersion(await access.json(`files/${source.noteId}`, { fields: DRIVE_NOTE_FIELDS }), scope, source));
    }
  }));
  return result.sort((a, b) => a.source.noteId.localeCompare(b.source.noteId));
}
