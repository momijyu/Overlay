import assert from "node:assert/strict";
import test from "node:test";
import { createThumbnailQueue, thumbnailWindow, THUMBNAIL_ROW_HEIGHT } from "@/features/pdf-editor/pageThumbnails";
import type { NotePage } from "@/features/pdf-editor/types";

const page = (number: number): NotePage => ({ id: number, kind: "pdf", pageNumber: number });
const signal = () => new AbortController().signal;

test("長い資料でも可視範囲と前後1枚だけを生成対象にする", () => {
  assert.deepEqual(thumbnailWindow(0, 630, 10000), { start: 0, end: 5 });
  assert.deepEqual(thumbnailWindow(100 * THUMBNAIL_ROW_HEIGHT, 630, 10000), { start: 99, end: 105 });
  assert.deepEqual(thumbnailWindow(0, 630, 0), { start: 0, end: 0 });
  assert.deepEqual(thumbnailWindow(99 * THUMBNAIL_ROW_HEIGHT, 630, 100), { start: 98, end: 100 });
});

test("背景の生成を直列にし、同じ元ページを複数箇所で使っても描画を共有する", async () => {
  const calls: number[] = [];
  let active = 0, maximum = 0;
  const source = createThumbnailQueue(async (entry) => {
    active++; maximum = Math.max(maximum, active); calls.push(entry.id);
    await new Promise(setImmediate); active--; return { value: entry.id };
  });
  const result = await Promise.all([source.get(page(1), signal()), source.get(page(2), signal()),
    source.get({ ...page(1), id: 99 }, signal())]);
  assert.equal(maximum, 1); assert.deepEqual(calls, [1, 2]);
  assert.equal(result[0], result[2]);
});

test("保持は直近24枚までとし、再利用した背景を残して古いものから再生成する", async () => {
  const calls: number[] = [];
  const source = createThumbnailQueue(async (entry) => { calls.push(entry.id); return entry.id; });
  for (let number = 1; number <= 24; number++) await source.get(page(number), signal());
  await source.get(page(1), signal());
  await source.get(page(25), signal());
  await source.get(page(1), signal());
  assert.equal(calls.length, 25);
  await source.get(page(2), signal());
  assert.deepEqual(calls.slice(-2), [25, 2]);
});

test("画面外の待機要求を実行せず、生成中の取消・失敗が次のページを止めない", async () => {
  const calls: number[] = [];
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const source = createThumbnailQueue(async (entry, abort) => {
    calls.push(entry.id);
    if (entry.id === 1) { await wait; abort.throwIfAborted(); }
    if (entry.id === 3) throw new Error("描画失敗");
    return entry.id;
  });
  const active = new AbortController(), queued = new AbortController();
  const first = source.get(page(1), active.signal);
  const second = source.get(page(2), queued.signal);
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  const secondRejected = assert.rejects(second, { name: "AbortError" });
  await new Promise(setImmediate);
  active.abort(); queued.abort(); release();
  await Promise.all([firstRejected, secondRejected]);
  await assert.rejects(source.get(page(3), signal()), /描画失敗/);
  assert.equal(await source.get(page(4), signal()), 4);
  assert.deepEqual(calls, [1, 3, 4]);
});

test("白紙テンプレートと寸法を区別し、PDFページとは背景を共有しない", async () => {
  let renders = 0;
  const source = createThumbnailQueue(async () => ++renders);
  const blank: NotePage = { id: 5, kind: "blank", width: 595, height: 842 };
  assert.equal(await source.get(blank, signal()), 1);
  assert.equal(await source.get({ ...blank, id: 6, template: "plain" }, signal()), 1);
  assert.equal(await source.get({ ...blank, template: "grid" }, signal()), 2);
  assert.equal(await source.get({ ...blank, width: 842 }, signal()), 3);
  assert.equal(await source.get(page(5), signal()), 4);
});
