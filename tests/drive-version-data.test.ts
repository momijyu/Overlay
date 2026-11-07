import assert from "node:assert/strict";
import test from "node:test";
import { activeDriveSources, mergeVersionAdoptions, readVersionAdoption, readVersionBase, sameSourceVersion, type VersionAdoption } from "@/features/pdf-editor/driveVersionData";
import { mergeLibraryEvents, readLibraryEvent, type LibraryEntity, type LibraryEvent, type LibrarySource } from "@/features/pdf-editor/driveLibraryData";

const source = (noteId: string): LibrarySource => ({ logicalId: "logical", noteId, noteKey: `key_${noteId}`, containerId: `container_${noteId}`, deviceId: `device_${noteId}`, fileName: "file.pdf" });
const version = (sourceId: string, checksum = "a".repeat(64)) => ({ sourceId, checksum, version: "1" });
const adoption = (changes: Partial<VersionAdoption> = {}): VersionAdoption => ({ logicalId: "logical", sourceId: "a", before: [], observed: [version("a"), version("b")], ...changes });
const entity = (): LibraryEntity => ({ id: "note:logical", head: "root", entry: { id: "logical", kind: "note", name: "資料", parentId: null, remoteId: "physical" }, sources: [source("a"), source("b")] });
const event = (id: string, value: VersionAdoption): LibraryEvent => ({ schemaVersion: 1, kind: "overlay-library-event", id, deviceId: "device", changes: [], adoption: value });

test("採用履歴は旧階層イベントと併存し、読込・再送時の形式が変わらない", () => {
  const row = entity(); const root: LibraryEvent = { schemaVersion: 1, kind: "overlay-library-event", id: "root", deviceId: "device", changes: [{ before: null, entry: row.entry }] };
  const events = [root, ...row.sources.map((s) => ({ ...root, id: `source_${s.noteId}`, changes: [], source: s })), event("chosen", adoption())];
  const parsed = events.map((e) => readLibraryEvent(JSON.parse(JSON.stringify(e))));
  const merged = mergeLibraryEvents(parsed).get(row.id)!;
  assert.deepEqual(activeDriveSources(merged).map((s) => s.noteId), ["a"]);
  assert.equal(merged.sources.length, 2); assert.deepEqual(readLibraryEvent(JSON.parse(JSON.stringify(parsed[3]))), parsed[3]);
  assert.throws(() => mergeLibraryEvents([...parsed, event("invalid", adoption({ logicalId: "missing" }))]), /対応するノート/);
});

test("採用済みでも旧版の内容変化・未確認の新規保存先を候補に戻し、版番号だけの変化は無視する", () => {
  const row = entity(); row.adoptions = [{ id: "chosen", adoption: adoption() }];
  assert.deepEqual(activeDriveSources(row, [version("a"), { ...version("b"), version: "2" }]).map((s) => s.noteId), ["a"]);
  assert.deepEqual(activeDriveSources(row, [version("a"), version("b", "b".repeat(64))]).map((s) => s.noteId), ["a", "b"]);
  row.sources.push(source("c")); assert.equal(activeDriveSources(row).length, 2);
  assert.equal(sameSourceVersion({ sourceId: "a", version: "1" }, { sourceId: "a", version: "2" }), false);
});

test("採用済み内容からの続きだけを自動採用し、並行した続き・元版の追加編集は選択対象に残す", () => {
  const row = entity(); row.adoptions = [{ id: "chosen", adoption: adoption() }];
  row.sources.push({ ...source("c"), basedOn: { ...version("a"), heads: ["chosen"] } });
  assert.deepEqual(activeDriveSources(row, [version("a"), version("b"), version("c")]).map((s) => s.noteId), ["c"]);
  row.sources.push({ ...source("d"), basedOn: { ...version("a"), heads: ["chosen"] } });
  assert.deepEqual(activeDriveSources(row, [version("a"), version("b"), version("c"), version("d")]).map((s) => s.noteId), ["c", "d"]);
  assert.deepEqual(activeDriveSources(row, [version("a", "c".repeat(64)), version("b"), version("c"), version("d")]).map((s) => s.noteId), ["a", "c", "d"]);
});

test("並行した採用結果を両方保持し、それらを参照した選択だけが決着になる", () => {
  const row = entity(); const a = event("one", adoption()); const b = event("two", adoption({ sourceId: "b" }));
  mergeVersionAdoptions(row, [a, b]); assert.equal(row.adoptions!.length, 2); assert.equal(activeDriveSources(row).length, 2);
  mergeVersionAdoptions(row, [a, b, event("three", adoption({ before: ["one", "two"] }))]);
  assert.deepEqual(row.adoptions!.map((h) => h.id), ["three"]);
});

test("不正な採用情報・欠損や循環する履歴・不明な引継ぎ元を拒否する", () => {
  for (const value of [adoption({ sourceId: "missing" }), adoption({ before: ["a", "a"] }), adoption({ observed: [] }), adoption({ observed: [version("a"), version("a")] }), adoption({ observed: [{ ...version("a"), checksum: "invalid" }] })]) assert.throws(() => readVersionAdoption(value));
  assert.throws(() => readVersionBase({ ...version("a"), heads: "invalid" }));
  assert.throws(() => mergeVersionAdoptions(entity(), [event("one", adoption({ before: ["missing"] }))]), /欠け/);
  assert.throws(() => mergeVersionAdoptions(entity(), [event("one", adoption({ before: ["one"] }))]), /循環/);
  const row = entity(); row.sources[0].basedOn = { ...version("a"), heads: ["one"] };
  assert.throws(() => mergeVersionAdoptions(row, [event("one", adoption())]), /引き継ぎ/);
});
