import { driveId, driveObject } from "./googleDriveNoteData";
import type { DriveStickyCache } from "./driveStickyIndexData";
import { mergeVersionAdoptions, readVersionAdoption, readVersionBase, type AdoptionHead, type SourceVersion, type VersionAdoption, type VersionBase } from "./driveVersionData";

export type LibraryScope = { accountId: string; rootId: string; deviceId: string; historyId?: string; historyCreated?: boolean };
export type LibraryEntry = { id: string; kind: "folder" | "note"; name: string; parentId: string | null; remoteId?: string; deleted?: boolean };
export type LibrarySource = { logicalId: string; noteId: string; noteKey: string; containerId: string; deviceId: string; fileName: string; updatedAt?: string; pdfHash?: string; basedOn?: VersionBase };
export type LibraryEvent = { schemaVersion: 1; kind: "overlay-library-event"; id: string; deviceId: string;
  changes: { before: string | string[] | null; entry: LibraryEntry }[]; source?: LibrarySource; adoption?: VersionAdoption };
export type LibraryEntity = { id: string; entry: LibraryEntry; head: string; sources: LibrarySource[];
  stickyIndexes?: DriveStickyCache[]; adoptions?: AdoptionHead[]; sourceVersions?: SourceVersion[];
  listed?: boolean; cachedSource?: string; cachedVersion?: string; cachedChecksum?: string; cachedBytes?: number; lastUsed?: number; cacheWarning?: string };
export type LibraryEventRow = { id: string; event: LibraryEvent; fileId?: string; hash?: string; sent: boolean };
export type LibraryConflictItem = { key: string; versions: { head: string; deviceId: string; entry: LibraryEntry }[] };
export class LibraryConflict extends Error {
  conflicts: LibraryConflictItem[];
  constructor(conflicts: LibraryConflictItem[]) {
    super("同じ項目の移動・名前変更が競合しています。両端末の変更を保持して停止しました。");
    this.name = "LibraryConflict"; this.conflicts = conflicts;
  }
}
export const LIBRARY_EVENT_BYTES = 64 * 1024;
export const LIBRARY_EVENT_LIMIT = 10000;
export const entityKey = (entry: Pick<LibraryEntry, "kind" | "id">) => `${entry.kind}:${entry.id}`;

function name(value: unknown, limit: number) {
  if (typeof value !== "string" || !value.trim() || [...value].length > limit || /\p{Cc}/u.test(value)) throw new Error("Drive階層の名前が不正です。");
  return value;
}
export function readLibraryEvent(input: unknown): LibraryEvent {
  const data = driveObject(input);
  if (data.schemaVersion !== 1 || data.kind !== "overlay-library-event" || !Array.isArray(data.changes) || data.changes.length > 100) throw new Error("Drive階層の形式に対応していません。");
  const changes = data.changes.map((item) => {
    const change = driveObject(item); const entry = driveObject(change.entry);
    if (entry.kind !== "note" && entry.kind !== "folder" || entry.deleted !== undefined && typeof entry.deleted !== "boolean") throw new Error("Drive階層の種類が不正です。");
    const before = change.before === null ? null : Array.isArray(change.before) ? change.before.map(driveId) : driveId(change.before);
    if (Array.isArray(before) && (before.length < 2 || before.length > 32 || new Set(before).size !== before.length)) throw new Error("階層の競合解決情報が不正です。");
    return { before, entry: {
      id: driveId(entry.id), kind: entry.kind, name: name(entry.name, entry.kind === "folder" ? 100 : 120),
      parentId: entry.parentId === null ? null : driveId(entry.parentId), remoteId: driveId(entry.remoteId),
      ...(entry.deleted ? { deleted: true } : {}),
    } as LibraryEntry };
  });
  if (new Set(changes.map((c) => entityKey(c.entry))).size !== changes.length) throw new Error("Drive階層の変更に重複があります。");
  let source: LibrarySource | undefined;
  if (data.source !== undefined) {
    const s = driveObject(data.source);
    if (s.pdfHash !== undefined && (typeof s.pdfHash !== "string" || !/^[a-f0-9]{64}$/.test(s.pdfHash))) throw new Error("DriveノートのPDF検証情報が不正です。");
    source = { logicalId: driveId(s.logicalId), noteId: driveId(s.noteId), noteKey: driveId(s.noteKey), containerId: driveId(s.containerId), deviceId: driveId(s.deviceId), fileName: name(s.fileName, 255),
      ...(typeof s.pdfHash === "string" && /^[a-f0-9]{64}$/.test(s.pdfHash) ? { pdfHash: s.pdfHash } : {}),
      ...(s.basedOn !== undefined ? { basedOn: readVersionBase(s.basedOn) } : {}) };
  }
  const adoption = data.adoption === undefined ? undefined : readVersionAdoption(data.adoption);
  if (!changes.length && !source && !adoption) throw new Error("Drive階層の変更が空です。");
  return { schemaVersion: 1, kind: "overlay-library-event", id: driveId(data.id), deviceId: driveId(data.deviceId), changes, ...(source ? { source } : {}), ...(adoption ? { adoption } : {}) };
}

// 移動履歴は不変のイベントとして残す。同じ基点からの二重変更を時刻で上書きしない。
export function mergeLibraryEvents(events: LibraryEvent[]): Map<string, LibraryEntity> {
  const unique = new Map<string, LibraryEvent>();
  for (const event of events) {
    const previous = unique.get(event.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) throw new Error("Drive階層の履歴IDが重複しています。");
    unique.set(event.id, event);
  }
  const versions = new Map<string, Map<string, LibraryEvent["changes"][number]>>();
  for (const event of unique.values()) for (const change of event.changes) {
    const key = entityKey(change.entry); const history = versions.get(key) ?? new Map();
    history.set(event.id, change); versions.set(key, history);
  }
  const result = new Map<string, LibraryEntity>();
  const conflicts: LibraryConflictItem[] = [];
  for (const [key, history] of versions) {
    const referenced = new Set<string>(); let roots = 0;
    for (const change of history.values()) {
      if (change.before === null) roots++;
      else {
        for (const id of Array.isArray(change.before) ? change.before : [change.before]) {
          const parent = history.get(id);
          if (!parent) throw new LibraryRetry("Drive階層の履歴が欠けています。取得を再試行します。");
          if (parent.entry.remoteId !== change.entry.remoteId) throw new Error("Drive階層の保存先IDが変更されています。");
          referenced.add(id);
        }
      }
    }
    const leaves = [...history.keys()].filter((id) => !referenced.has(id));
    if (roots !== 1 || !leaves.length) throw new Error("Drive階層の作成が競合しているか、履歴が循環しています。");
    if (leaves.length > 1) {
      conflicts.push({ key, versions: leaves.map((head) => ({ head, deviceId: unique.get(head)!.deviceId, entry: history.get(head)!.entry })) });
      continue;
    }
    const head = leaves[0]; const visited = new Set<string>(); const visiting = new Set<string>();
    const stack = [{ id: head, exit: false }];
    while (stack.length) {
      const current = stack.pop()!;
      if (current.exit) { visiting.delete(current.id); visited.add(current.id); continue; }
      if (visiting.has(current.id)) throw new Error("Drive階層の履歴が循環しています。");
      if (visited.has(current.id)) continue;
      visiting.add(current.id); stack.push({ id: current.id, exit: true });
      const before = history.get(current.id)!.before;
      if (before !== null) for (const parent of Array.isArray(before) ? before : [before]) stack.push({ id: parent, exit: false });
    }
    if (visited.size !== history.size) throw new Error("Drive階層の履歴が分岐しています。");
    result.set(key, { id: key, head, entry: history.get(head)!.entry, sources: [] });
  }
  if (conflicts.length) throw new LibraryConflict(conflicts);
  for (const event of unique.values()) if (event.source) {
    const entry = result.get(`note:${event.source.logicalId}`);
    if (!entry) throw new Error("Driveノートに対応する階層がありません。");
    const same = entry.sources.find((s) => s.noteId === event.source!.noteId);
    if (same && JSON.stringify(same) !== JSON.stringify(event.source)) throw new Error("Driveノートの保存先が一致しません。");
    if (!same) entry.sources.push(event.source);
  }
  const destinations = new Set<string>(); const physicalIds = new Set<string>();
  for (const event of unique.values()) if (event.adoption && !result.has(`note:${event.adoption.logicalId}`)) throw new Error("採用履歴に対応するノートがありません。");
  for (const row of result.values()) {
    mergeVersionAdoptions(row, [...unique.values()]);
    if (row.entry.deleted) continue;
    if (physicalIds.has(row.entry.remoteId!)) throw new Error("Drive階層の保存先IDが重複しています。");
    physicalIds.add(row.entry.remoteId!);
    if (row.entry.kind === "folder") {
      const name = `${row.entry.parentId ?? ""}\u0000${row.entry.name}`;
      if (destinations.has(name)) throw new Error("同じ場所に同名フォルダがあります。自動統合せず停止しました。");
      destinations.add(name);
    }
    const visited = new Set([row.entry.id]); let parent = row.entry.parentId;
    while (parent !== null) {
      const ancestor = result.get(`folder:${parent}`);
      if (!ancestor) throw new LibraryRetry("Drive階層の移動先を取得中です。再試行します。");
      if (visited.size > 100 || ancestor.entry.deleted || visited.has(parent)) throw new Error("移動先が削除されたか、フォルダが循環しています。階層を変更せず停止しました。");
      visited.add(parent); parent = ancestor.entry.parentId;
    }
  }
  return result;
}

export class LibraryRetry extends Error {}
