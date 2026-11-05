import assert from "node:assert/strict";
import test from "node:test";
import { createDriveBatch, prepareDriveBatch, saveDriveBatch, type DriveBatchAccess, type DriveBatchEntry, type DriveSaveSource } from "@/features/pdf-editor/googleDriveBatch";
import type { NoteBackup } from "@/features/pdf-editor/noteBackupData";
import type { DriveNoteSummary, DriveOverwriteTarget } from "@/features/pdf-editor/googleDriveNoteData";

const backup = (title: string): NoteBackup => ({ schemaVersion: 1, kind: "note", name: title, folders: [],
  notes: [{ id: "local", title, fileName: "sample.pdf", folderId: null, pdf: new Blob(["%PDF-1.7"]), strokesByPage: {}, textsByPage: {} }] });
const summary = (title: string): DriveNoteSummary => ({ id: `drive_${title}`, title, containerId: "container", noteKey: "key", updatedAt: "2026-11-04" });
function fixture() {
  const events: string[] = [], targets: (DriveOverwriteTarget | null)[] = [];
  let active = true, failLookup = "", failSave = "";
  const sources: DriveSaveSource[] = ["A", "B", "C"].map((title) => ({ id: title, title,
    load: async () => { events.push(`load:${title}`); return backup(title); } }));
  let entries = createDriveBatch(sources);
  const access: DriveBatchAccess = {
    findSaveTargetByTitle: async (account, root, title) => {
      assert.equal(account, "account"); assert.equal(root, "root"); events.push(`check:${title}`);
      if (title === failLookup) throw new Error("保存先の確認失敗");
      return title === "B" ? { note: summary(title), version: "1" } : null;
    },
    saveConfirmedNote: async (_account, _root, data, target) => {
      const title = data.notes[0].title; events.push(`save:${title}`); targets.push(target);
      if (title === failSave) throw new Error("送信結果が不明です");
      return summary(title);
    },
  };
  const update = (value: DriveBatchEntry[]) => { entries = value; };
  const saved: DriveNoteSummary[] = [];
  return { sources, events, targets, access, saved, entries: () => entries,
    stop() { active = false; }, failLookup(value: string) { failLookup = value; }, failSave(value: string) { failSave = value; },
    prepare: () => prepareDriveBatch(entries, access, "account", "root", () => active, update),
    save: () => saveDriveBatch(entries, access, "account", "root", () => active, update, (note) => saved.push(note)) };
}

test("一括確認はPDFを読まず新規・上書きを判別し、承認後だけ1件ずつ取得・保存する", async () => {
  const f = fixture(); await f.prepare();
  assert.deepEqual(f.events, ["check:A", "check:B", "check:C"]);
  assert.deepEqual(f.entries().map((entry) => entry.status), ["ready", "ready", "ready"]);
  await f.save();
  assert.deepEqual(f.events.slice(3), ["load:A", "save:A", "load:B", "save:B", "load:C", "save:C"]);
  assert.deepEqual(f.targets, [null, { note: summary("B"), version: "1" }, null]);
  assert.equal(f.saved.length, 3);
  assert.ok(f.entries().every((entry) => entry.status === "saved"));
});

test("一括保存もノートごとの見出しを保持し、確認前には本文を読み出さない", async () => {
  const f = fixture();
  f.sources[0].load = async () => ({ ...backup("A"), schemaVersion: 4,
    notes: [{ ...backup("A").notes[0], headingsByPage: { 1: "授業の要点" } }] });
  const received: NoteBackup[] = [];
  const access = { ...f.access, saveConfirmedNote: async (_account: string, _root: string, data: NoteBackup) => {
    received.push(data); return summary(data.notes[0].title);
  } };
  const ready = await prepareDriveBatch(createDriveBatch(f.sources), access, "account", "root", () => true, () => {});
  assert.equal(received.length, 0);
  assert.ok(f.events.every((event) => event.startsWith("check:")));
  await saveDriveBatch(ready, access, "account", "root", () => true, () => {}, () => {});
  assert.equal(received.length, 3);
  assert.equal(received[0].schemaVersion, 4);
  assert.deepEqual(received[0].notes[0].headingsByPage, { 1: "授業の要点" });
  assert.equal(received[1].notes[0].headingsByPage, undefined);
});

test("同名の複数選択・重複ID・件数超過は送信前に拒否する", () => {
  const f = fixture();
  assert.throws(() => createDriveBatch([]), /1〜200/);
  assert.throws(() => createDriveBatch([f.sources[0], f.sources[0]]), /1〜200/);
  assert.throws(() => createDriveBatch([f.sources[0], { ...f.sources[1], title: "A" }]), /同名/);
  assert.throws(() => createDriveBatch(Array.from({ length: 201 }, (_, i) => ({ ...f.sources[0], id: String(i), title: String(i) }))), /1〜200/);
  assert.throws(() => createDriveBatch([{ ...f.sources[0], title: "bad\nname" }]), /不正/);
  assert.deepEqual(f.events, []);
});

test("未確認・確認失敗の対象が残っていれば全体の保存を開始しない", async () => {
  const f = fixture();
  await assert.rejects(f.save(), /保存先を確認/);
  f.failLookup("B"); await f.prepare();
  assert.deepEqual(f.events, ["check:A", "check:B"]);
  assert.equal(f.entries()[1].status, "failed");
  assert.equal(f.entries()[2].status, "unchecked");
  await assert.rejects(f.save(), /保存先を確認/);
  assert.equal(f.saved.length, 0);
});

test("途中失敗では成功分を維持し後続を送らず、再確認後も成功分は検索・送信しない", async () => {
  const f = fixture(); await f.prepare(); f.events.length = 0;
  f.failSave("B"); await f.save();
  assert.deepEqual(f.entries().map((entry) => entry.status), ["saved", "failed", "ready"]);
  assert.deepEqual(f.events, ["load:A", "save:A", "load:B", "save:B"]);
  await assert.rejects(f.save(), /確認/);
  f.failSave(""); f.events.length = 0;
  await f.prepare(); await f.save();
  assert.deepEqual(f.events, ["check:B", "check:C", "load:B", "save:B", "load:C", "save:C"]);
  assert.deepEqual(f.saved.map((note) => note.title), ["A", "B", "C"]);
});

test("確認後の改名や読み出し失敗ではそのノートと後続を送信しない", async () => {
  for (const changed of [false, true]) {
    const f = fixture();
    f.sources[0].load = async () => { if (!changed) throw new Error("元PDFがありません"); return backup("別名"); };
    const entries = createDriveBatch(f.sources);
    const ready = await prepareDriveBatch(entries, f.access, "account", "root", () => true, () => {});
    let result = ready;
    await saveDriveBatch(ready, f.access, "account", "root", () => true, (value) => { result = value; }, () => {});
    assert.equal(result[0].status, "failed");
    assert.match(result[0].error!, changed ? /ノート名が変わり/ : /元PDF/);
    assert.equal(f.targets.length, 0);
  }
});

test("閉鎖後は遅れた読込結果から保存へ進まず、後続の取得も行わない", async () => {
  const f = fixture();
  let release!: (value: NoteBackup) => void;
  f.sources[0].load = () => new Promise((resolve) => { release = resolve; });
  const ready = await prepareDriveBatch(createDriveBatch(f.sources), f.access, "account", "root", () => true, () => {});
  let active = true; const changes: unknown[] = [];
  const saving = saveDriveBatch(ready, f.access, "account", "root", () => active, (value) => changes.push(value), () => {});
  active = false; release(backup("A")); await saving;
  assert.equal(f.targets.length, 0);
  assert.equal(changes.length, 1); // 取得前の「保存中」だけ。
});

test("閉鎖後の確認結果・送信結果を反映せず次のノートへ進まない", async () => {
  const f = fixture(); let active = true;
  let resolve!: (value: DriveOverwriteTarget | null) => void;
  const access = { ...f.access, findSaveTargetByTitle: () => new Promise<DriveOverwriteTarget | null>((done) => { resolve = done; }) };
  let updated = 0;
  const pending = prepareDriveBatch(createDriveBatch(f.sources), access, "account", "root", () => active, () => { updated++; });
  active = false; resolve(null); await pending; assert.equal(updated, 0);
  const ready = await f.prepare(); active = true;
  const writing = { ...f.access, saveConfirmedNote: async () => { active = false; return summary("A"); } };
  await saveDriveBatch(ready, writing, "account", "root", () => active, () => {}, () => { updated++; });
  assert.equal(updated, 0); assert.equal(f.events.filter((entry) => entry.startsWith("load:")).length, 1);
});
