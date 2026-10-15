import assert from "node:assert/strict";
import test from "node:test";
import { attachLocalAutosaveLifecycle, createLocalAutosave, type LocalSaveInput, type LocalSaveState } from "@/features/pdf-editor/localAutosave";
import type { PenStroke } from "@/features/pdf-editor/types";

const file = new File(["test pdf"], "sample.pdf");
const empty: Record<number, PenStroke[]> = {};
const first = { 1: [{ width: 2.5, points: [{ x: 0.1, y: 0.2 }] }] };
const second = { ...first, 2: first[1] };
const latest = { ...second, 3: first[1] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

test("新規PDFを開いただけではDirtyにも保存済みにもせず、flushしても保存しない", async () => {
  let writes = 0;
  const autosave = createLocalAutosave({
    file, noteId: null, strokesByPage: empty,
    persist: async () => { writes++; return "note"; }, onChange: () => {},
  });
  assert.equal(autosave.hasPendingChanges(), false);
  assert.equal(autosave.getState().status, "idle");
  assert.equal(await autosave.flush(), true);
  assert.equal(await autosave.flush(true), true);
  assert.equal(writes, 0);
  assert.equal(autosave.getState().noteId, null);
});

test("最初の線から新規PDFを自動保存し、保存の応答前に保存済みと表示しない", async () => {
  const write = deferred<string>();
  const calls: LocalSaveInput[] = [];
  const states: LocalSaveState[] = [];
  const autosave = createLocalAutosave({
    file, noteId: null, strokesByPage: empty,
    persist: async (input) => { calls.push(input); return write.promise; },
    onChange: (state) => states.push(state),
  });
  autosave.update(first);
  const saving = autosave.flush();
  assert.equal(autosave.getState().status, "saving");
  assert.equal(autosave.hasPendingChanges(), true);
  assert.equal(autosave.getState().savedStrokes, empty);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  write.resolve("note-1");
  assert.equal(await saving, true);
  assert.equal(calls[0].strokesByPage, first);
  assert.deepEqual(autosave.getState(), { status: "saved", noteId: "note-1", savedStrokes: first, error: null });
  assert.equal(autosave.hasPendingChanges(), false);
  assert.equal(states.at(-1)?.status, "saved");
});

test("既存ノートを開くだけでは再保存しない", async () => {
  let writes = 0;
  const autosave = createLocalAutosave({
    file, noteId: "existing", strokesByPage: first, revision: 8,
    persist: async () => { writes++; return "existing"; }, onChange: () => {},
  });
  assert.equal(await autosave.flush(), true);
  assert.equal(writes, 0);
  assert.equal(autosave.hasPendingChanges(), false);
});

test("線を描き終えてupdateすると、保存ボタンなしで保存を開始する", async () => {
  const calls: LocalSaveInput[] = [];
  const autosave = createLocalAutosave({
    file, noteId: "existing", strokesByPage: empty, revision: 4,
    persist: async (input) => { calls.push(input); return "existing"; }, onChange: () => {},
  });
  autosave.update(first);
  await autosave.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].strokesByPage, first);
  assert.equal(calls[0].expectedRevision, 4);
  assert.equal(autosave.getState().savedStrokes, first);
});

test("初回保存中の連続描画をまとめ、同じIDへ順番に更新する", async () => {
  const initialWrite = deferred<string>();
  const updateWrite = deferred<string>();
  const calls: LocalSaveInput[] = [];
  let concurrent = 0;
  let maximum = 0;
  const autosave = createLocalAutosave({
    file, noteId: null, strokesByPage: empty,
    persist: async (input) => {
      calls.push(input);
      maximum = Math.max(maximum, ++concurrent);
      const id = await (calls.length === 1 ? initialWrite.promise : updateWrite.promise);
      concurrent--;
      return id;
    }, onChange: () => {},
  });
  autosave.update(first);
  const saving = autosave.flush();
  await Promise.resolve();
  autosave.update(first);
  autosave.update(second);
  autosave.update(latest);
  assert.equal(autosave.flush(true), saving);
  initialWrite.resolve("created");
  // 2回目のpersistが始まるまでマイクロタスクを進める。
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].noteId, "created");
  assert.equal(calls[1].expectedRevision, 1);
  assert.equal(calls[1].strokesByPage, latest);
  assert.equal(autosave.getState().savedStrokes, first);
  assert.equal(autosave.getState().status, "saving");
  updateWrite.resolve("created");
  assert.equal(await saving, true);
  assert.equal(maximum, 1);
  assert.equal(autosave.getState().savedStrokes, latest);
});

test("保存失敗後も最新の線を保持し、自動再試行せず手動で再試行できる", async () => {
  let fails = true;
  const calls: LocalSaveInput[] = [];
  const autosave = createLocalAutosave({
    file, noteId: "existing", strokesByPage: empty, revision: 3,
    persist: async (input) => {
      calls.push(input);
      if (fails) throw new Error("容量不足");
      return "existing";
    }, onChange: () => {},
  });
  autosave.update(first);
  assert.equal(await autosave.flush(), false);
  assert.equal(autosave.getState().error, "容量不足");
  assert.equal(autosave.getState().savedStrokes, empty);
  autosave.update(second);
  assert.equal(await autosave.flush(), false);
  assert.equal(calls.length, 1);
  fails = false;
  assert.equal(await autosave.flush(true), true);
  assert.equal(calls[1].strokesByPage, second);
  assert.equal(calls[1].expectedRevision, 3);
  assert.equal(autosave.getState().error, null);
});

test("初回成功・続く更新失敗の後も、同じIDで再試行してPDFを重複作成しない", async () => {
  const initialWrite = deferred<string>();
  const calls: LocalSaveInput[] = [];
  let fails = true;
  const autosave = createLocalAutosave({
    file, noteId: null, strokesByPage: empty,
    persist: async (input) => {
      calls.push(input);
      if (calls.length === 1) return initialWrite.promise;
      if (fails) throw new Error("保存できません");
      return "created";
    }, onChange: () => {},
  });
  autosave.update(first);
  const saving = autosave.flush();
  await Promise.resolve();
  autosave.update(second);
  initialWrite.resolve("created");
  assert.equal(await saving, false);
  assert.equal(autosave.getState().noteId, "created");
  fails = false;
  assert.equal(await autosave.flush(true), true);
  assert.equal(calls[2].noteId, "created");
  assert.equal(calls[2].expectedRevision, 1);
});

test("画面から外れた保存係は書き込みを完了しても新しい画面へ通知しない", async () => {
  const write = deferred<string>();
  const states: LocalSaveState[] = [];
  const autosave = createLocalAutosave({
    file, noteId: null, strokesByPage: empty,
    persist: async () => write.promise, onChange: (state) => states.push(state),
  });
  autosave.update(first);
  const saving = autosave.flush();
  autosave.dispose();
  const count = states.length;
  write.resolve("old-note");
  assert.equal(await saving, true);
  assert.equal(states.length, count);
  autosave.update(second);
  assert.equal(autosave.getState().savedStrokes, first);
});

test("失敗した保存係から別のノートへ状態や線を引き継がない", async () => {
  const old = createLocalAutosave({
    file, noteId: "old", strokesByPage: empty,
    persist: async () => { throw new Error("old failure"); }, onChange: () => {},
  });
  old.update(first);
  assert.equal(await old.flush(), false);
  const next = createLocalAutosave({
    file, noteId: "next", strokesByPage: second,
    persist: async () => "next", onChange: () => {},
  });
  assert.equal(next.getState().error, null);
  assert.equal(next.getState().savedStrokes, second);
  assert.equal(next.getState().noteId, "next");
});

test("非表示・pagehideで保存を確認し、未保存時だけ終了を警告する", async () => {
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const view = new EventTarget();
  let flushes = 0;
  const original = createLocalAutosave({
    file, noteId: null, strokesByPage: empty, persist: async () => "note", onChange: () => {},
  });
  const autosave = { ...original, flush: () => { flushes++; return original.flush(); } };
  const cleanup = attachLocalAutosaveLifecycle(view as unknown as Window, page as unknown as Document, () => autosave);
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(flushes, 0);
  const cleanLeaving = new Event("beforeunload", { cancelable: true });
  view.dispatchEvent(cleanLeaving);
  assert.equal(cleanLeaving.defaultPrevented, false);
  original.update(first);
  const leaving = new Event("beforeunload", { cancelable: true });
  view.dispatchEvent(leaving);
  assert.equal(leaving.defaultPrevented, true);
  await autosave.flush();
  const savedLeaving = new Event("beforeunload", { cancelable: true });
  view.dispatchEvent(savedLeaving);
  assert.equal(savedLeaving.defaultPrevented, false);
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  view.dispatchEvent(new Event("pagehide"));
  assert.equal(flushes, 4);
  cleanup();
  view.dispatchEvent(new Event("pagehide"));
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(flushes, 4);
});
