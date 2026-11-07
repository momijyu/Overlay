import { driveId, driveObject } from "./googleDriveNoteData";
import type { LibraryEntity, LibrarySource } from "./driveLibraryData";

export type SourceVersion = { sourceId: string; version: string; checksum?: string };
export type VersionBase = SourceVersion & { heads: string[] };
export type VersionAdoption = { logicalId: string; before: string[]; sourceId: string; observed: SourceVersion[] };
export type AdoptionHead = { id: string; adoption: VersionAdoption };

export function readSourceVersion(input: unknown): SourceVersion {
  const value = driveObject(input);
  if (typeof value.version !== "string" || !/^\d{1,30}$/.test(value.version)
    || value.checksum !== undefined && (typeof value.checksum !== "string" || !/^[a-f0-9]{64}$/.test(value.checksum))) throw new Error("編集版の確認情報が不正です。");
  return { sourceId: driveId(value.sourceId), version: value.version, ...(value.checksum ? { checksum: value.checksum as string } : {}) };
}
export function readVersionHeads(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 32) throw new Error("採用履歴の参照が不正です。");
  const ids = input.map(driveId);
  if (new Set(ids).size !== ids.length) throw new Error("採用履歴の参照が重複しています。");
  return ids;
}
export function readVersionBase(input: unknown): VersionBase {
  return { ...readSourceVersion(input), heads: readVersionHeads(driveObject(input).heads) };
}
export function readVersionAdoption(input: unknown): VersionAdoption {
  const value = driveObject(input);
  if (!Array.isArray(value.observed) || !value.observed.length || value.observed.length > 100) throw new Error("採用する編集版の件数が不正です。");
  const observed = value.observed.map(readSourceVersion);
  const sourceId = driveId(value.sourceId);
  if (new Set(observed.map((v) => v.sourceId)).size !== observed.length || !observed.some((v) => v.sourceId === sourceId)) throw new Error("採用する編集版の参照が不正です。");
  return { logicalId: driveId(value.logicalId), before: readVersionHeads(value.before), sourceId, observed };
}
export function sameSourceVersion(a: SourceVersion, b: SourceVersion) {
  return a.sourceId === b.sourceId && (a.checksum ? a.checksum === b.checksum : a.version === b.version);
}
export function adoptionSignature(row: Pick<LibraryEntity, "adoptions">) {
  return JSON.stringify([...(row.adoptions ?? [])].sort((a, b) => a.id.localeCompare(b.id)));
}

// 採用時に確認した旧版は隠す。未確認の変更・分岐は時刻で勝手に選ばない。
export function activeDriveSources(row: LibraryEntity, versions = row.sourceVersions ?? []): LibrarySource[] {
  if (row.adoptions?.length !== 1) return row.sources;
  const head = row.adoptions[0]; const adoption = head.adoption;
  const current = new Map(versions.map((v) => [v.sourceId, v]));
  const observed = new Map(adoption.observed.map((v) => [v.sourceId, v]));
  const candidates = row.sources.filter((source) => source.noteId === adoption.sourceId || !observed.has(source.noteId)
    || current.has(source.noteId) && !sameSourceVersion(observed.get(source.noteId)!, current.get(source.noteId)!));
  const replaced = new Set<string>();
  for (const source of candidates) {
    const base = source.basedOn;
    if (base?.heads.length === 1 && base.heads[0] === head.id && current.has(base.sourceId)
      && sameSourceVersion(base, current.get(base.sourceId)!)) replaced.add(base.sourceId);
  }
  return candidates.filter((s) => !replaced.has(s.noteId));
}

export function mergeVersionAdoptions(row: LibraryEntity, events: { id: string; adoption?: VersionAdoption }[]) {
  const history = new Map(events.filter((e) => e.adoption?.logicalId === row.entry.id).map((e) => [e.id, e.adoption!]));
  if (!history.size) {
    if (row.sources.some((s) => s.basedOn)) throw new Error("編集の引き継ぎに対応する採用履歴がありません。");
    return;
  }
  for (const source of row.sources) {
    if (!source.basedOn) continue;
    const visited = new Set([source.noteId]); let base: VersionBase | undefined = source.basedOn;
    while (base) {
      if (visited.has(base.sourceId) || !row.sources.some((s) => s.noteId === base!.sourceId)
        || base.heads.length !== 1 || !history.has(base.heads[0]) || visited.size > 100) throw new Error("編集の引き継ぎ元を確認できません。");
      visited.add(base.sourceId); base = row.sources.find((s) => s.noteId === base!.sourceId)?.basedOn;
    }
  }
  const referenced = new Set<string>();
  for (const adoption of history.values()) {
    if (row.entry.kind !== "note" || adoption.observed.some((v) => !row.sources.some((s) => s.noteId === v.sourceId))) throw new Error("採用履歴の編集版が見つかりません。");
    for (const id of adoption.before) {
      if (!history.has(id)) throw new Error("採用履歴が欠けています。再取得してください。");
      referenced.add(id);
    }
  }
  const visiting = new Set<string>(); const visited = new Set<string>();
  for (const id of history.keys()) {
    const stack = [{ id, exit: false }];
    while (stack.length) {
      const item = stack.pop()!;
      if (item.exit) { visiting.delete(item.id); visited.add(item.id); continue; }
      if (visiting.has(item.id)) throw new Error("採用履歴が循環しています。");
      if (visited.has(item.id)) continue;
      visiting.add(item.id); stack.push({ id: item.id, exit: true });
      for (const parent of history.get(item.id)!.before) stack.push({ id: parent, exit: false });
    }
  }
  row.adoptions = [...history].filter(([id]) => !referenced.has(id)).map(([id, adoption]) => ({ id, adoption })).sort((a, b) => a.id.localeCompare(b.id));
}
