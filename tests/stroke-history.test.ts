import assert from "node:assert/strict";
import test from "node:test";
import { createStrokeHistory, recordStrokeEdit, undoStrokeEdit, redoStrokeEdit, STROKE_HISTORY_LIMIT } from "@/features/pdf-editor/strokeHistory";
import { eraseStrokes } from "@/features/pdf-editor/eraseStrokes";
import type { PenStroke } from "@/features/pdf-editor/types";

const red: PenStroke = { width: 2.5, color: "#ff0000", points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] };
const blue: PenStroke = { ...red, color: "#0000ff" };

test("読み込んだノートは既存の線を維持し、Undo・Redoの履歴を持たない", () => {
  const initial = { 1: [red] };
  const history = createStrokeHistory(initial);
  assert.equal(history.strokesByPage, initial);
  assert.equal(undoStrokeEdit(history), history);
  assert.equal(redoStrokeEdit(history), history);
  assert.equal(history.changedPage, null);
});

test("描画と部分消去を1操作ずつ戻し、色・太さ・元の座標をそのままやり直す", () => {
  const initial = createStrokeHistory({});
  const drawn = recordStrokeEdit(initial, 1, [red]);
  const point = { x: 0.5, y: 0.5 };
  const fragments = eraseStrokes(drawn.strokesByPage[1], point, point, 100, 100, 10, 1);
  const erased = recordStrokeEdit(drawn, 1, fragments);
  assert.equal(erased.past.length, 2);
  const restored = undoStrokeEdit(erased);
  assert.equal(restored.strokesByPage, drawn.strokesByPage);
  assert.equal(undoStrokeEdit(restored).strokesByPage, initial.strokesByPage);
  const redoDraw = redoStrokeEdit(undoStrokeEdit(restored));
  assert.equal(redoDraw.strokesByPage, drawn.strokesByPage);
  assert.equal(redoStrokeEdit(redoDraw).strokesByPage, erased.strokesByPage);
  assert.equal(erased.strokesByPage[1].length, 2);
  assert.ok(erased.strokesByPage[1].every((stroke) => stroke.color === red.color && stroke.width === red.width));
  assert.equal(initial.strokesByPage[1], undefined);
});

test("全消去もUndoでき、再実行では空のページへ戻る", () => {
  const initial = createStrokeHistory({ 1: [red], 2: [blue] });
  const erased = recordStrokeEdit(initial, 1, []);
  assert.deepEqual(erased.strokesByPage[1], []);
  const undone = undoStrokeEdit(erased);
  assert.equal(undone.strokesByPage[1], initial.strokesByPage[1]);
  const redone = redoStrokeEdit(undone);
  assert.deepEqual(redone.strokesByPage[1], []);
  assert.equal(redone.strokesByPage[2], initial.strokesByPage[2]);
});

test("複数ページの編集を操作順に戻し、対象ページと他ページの内容を維持する", () => {
  const first = recordStrokeEdit(createStrokeHistory({}), 1, [red]);
  const second = recordStrokeEdit(first, 2, [blue]);
  const third = recordStrokeEdit(second, 1, []);
  const undone = undoStrokeEdit(third);
  assert.equal(undone.changedPage, 1);
  assert.deepEqual(undone.strokesByPage, { 1: [red], 2: [blue] });
  const back = undoStrokeEdit(undone);
  assert.equal(back.changedPage, 2);
  assert.deepEqual(back.strokesByPage, { 1: [red] });
  assert.equal(redoStrokeEdit(back).changedPage, 2);
});

test("Undo後に新しい編集をした場合はRedoを破棄し、変更なしなら保持する", () => {
  const initial = createStrokeHistory({ 1: [red] });
  const second = recordStrokeEdit(initial, 1, [red, blue]);
  const undone = undoStrokeEdit(second);
  assert.equal(recordStrokeEdit(undone, 1, undone.strokesByPage[1]), undone);
  assert.equal(recordStrokeEdit(undone, 3, []), undone);
  for (const invalid of [0, -1, 1.5, NaN, Infinity]) assert.equal(recordStrokeEdit(undone, invalid, [blue]), undone);
  assert.equal(undone.future.length, 1);
  const branch = recordStrokeEdit(undone, 2, [blue]);
  assert.equal(branch.future.length, 0);
  assert.equal(redoStrokeEdit(branch), branch);
});

test("履歴は直近100操作までで、制限を超えても線の内容を失わない", () => {
  let history = createStrokeHistory({});
  for (let i = 0; i < STROKE_HISTORY_LIMIT + 5; i++) {
    history = recordStrokeEdit(history, 1, [...(history.strokesByPage[1] ?? []), red]);
  }
  assert.equal(history.past.length, 100);
  assert.equal(history.strokesByPage[1].length, 105);
  for (let i = 0; i < 100; i++) history = undoStrokeEdit(history);
  assert.equal(history.strokesByPage[1].length, 5);
  assert.equal(undoStrokeEdit(history), history);
  for (let i = 0; i < 100; i++) history = redoStrokeEdit(history);
  assert.equal(history.strokesByPage[1].length, 105);
  assert.equal(history.past.length, 100);
  assert.equal(redoStrokeEdit(history), history);
});

test("ノートの読み直しで履歴だけをリセットし、線や別ノートの履歴を変更しない", () => {
  const first = recordStrokeEdit(createStrokeHistory({}), 1, [red]);
  const reset = createStrokeHistory(first.strokesByPage);
  assert.equal(reset.past.length, 0);
  assert.equal(reset.future.length, 0);
  assert.equal(reset.strokesByPage, first.strokesByPage);
  const other = recordStrokeEdit(createStrokeHistory({}), 2, [blue]);
  assert.deepEqual(undoStrokeEdit(other).strokesByPage, {});
  assert.deepEqual(first.strokesByPage, { 1: [red] });
});
