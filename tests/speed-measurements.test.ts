import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createSpeedMeasurements, measureSpeed, speedMeasurements, type SpeedInfo } from "@/features/pdf-editor/speedMeasurements";

afterEach(() => speedMeasurements.clear());

test("計測は既定で無効、時計・記録を使わず、開始後だけ親子の所要時間を残す", () => {
  let time = 10, calls = 0;
  const log = createSpeedMeasurements(() => { calls++; return time; });
  log.begin("note.open").finish(); assert.equal(calls, 0);
  log.start(); const parent = log.begin("note.open");
  time = 20; const child = log.begin("note.read", { pdfBytes: 12 }, parent.id);
  time = 35; assert.equal(child.elapsedMs(), 15); child.finish(); child.finish("error");
  time = 40; parent.finish(); const result = log.stop();
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records[0], { id: 2, parentId: 1, phase: "note.read", startMs: 10, durationMs: 15, outcome: "ok", info: { pdfBytes: 12 } });
  assert.equal(result.records[1].durationMs, 30);
  result.records[0].info.pdfBytes = 999;
  assert.equal(log.snapshot().records[0].info.pdfBytes, 12);
});

test("停止・開始・消去をまたぐ遅い処理は次の記録へ混入しない", () => {
  let time = 0; const log = createSpeedMeasurements(() => time);
  log.start(); const old = log.begin("drive.http"); time = 20;
  assert.equal(log.stop().records[0].outcome, "incomplete");
  log.start(); const next = log.begin("note.read"); old.finish();
  assert.equal(log.snapshot().active, 1);
  const late = log.begin("pdf.render", undefined, old.id); late.finish();
  assert.equal(log.snapshot().records.at(-1)!.parentId, undefined);
  next.finish();
  log.clear(); next.finish(); assert.equal(log.snapshot().records.length, 0);
  assert.equal(log.snapshot().recording, false);
});

test("ログは許可した数値・列挙値だけを保存し、名前・ID・URL・例外本文を受け入れない", () => {
  const log = createSpeedMeasurements(() => 0); log.start();
  const unsafe = { pdfBytes: 100, pageCount: NaN, height: -1, width: Number.MAX_VALUE,
    requestKind: "account", method: "GET", firstUpload: false,
    title: "秘密資料", token: "secret-token", id: "account-id", url: "https://private.example", error: "private-error" } as SpeedInfo;
  log.begin("note.read", unsafe).finish("ok", { bodyMs: Infinity, headersMs: 1.234, method: "secret-token" } as unknown as SpeedInfo);
  const result = log.stop(); const info = result.records[0].info;
  assert.deepEqual(Object.keys(info).sort(), ["firstUpload", "headersMs", "method", "pdfBytes", "requestKind", "width"]);
  assert.equal(info.headersMs, 1.23); assert.ok(Number.isFinite(info.width));
  assert.doesNotMatch(JSON.stringify(result), /秘密|secret|private|account-id/);
});

test("完了1000件・実行中100件で打ち切り、未完了も上限内に収める", () => {
  const log = createSpeedMeasurements(() => 0); log.start();
  for (let i = 0; i < 1005; i++) log.begin("local.save").finish();
  assert.equal(log.snapshot().records.length, 1000); assert.equal(log.snapshot().dropped, 5);
  for (let i = 0; i < 110; i++) log.begin("drive.http");
  assert.equal(log.snapshot().active, 100); assert.equal(log.snapshot().dropped, 15);
  const result = log.stop(); assert.equal(result.records.length, 1000); assert.equal(result.dropped, 115);
});

test("計測の例外本文を保存せず、元の成功値と例外をそのまま返す", async () => {
  speedMeasurements.start(); const expected = { value: 1 };
  assert.equal(await measureSpeed("note.read", async () => expected), expected);
  const failure = new Error("secret response");
  await assert.rejects(measureSpeed("drive.http", async () => { throw failure; }), (error) => error === failure);
  const result = speedMeasurements.stop();
  assert.deepEqual(result.records.map((row) => row.outcome), ["ok", "error"]);
  assert.doesNotMatch(JSON.stringify(result), /secret response/);
});

test("時計が使えない時にもアプリ処理を妨げない", () => {
  const log = createSpeedMeasurements(() => { throw new Error("unavailable"); });
  log.start(); log.begin("note.open").finish();
  assert.equal(log.stop().records[0].durationMs, 0);
});
