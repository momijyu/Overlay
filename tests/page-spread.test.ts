import assert from "node:assert/strict";
import test from "node:test";
import { adjacentPageNumber, visiblePageNumbers } from "@/features/pdf-editor/pageSpread";

test("見開きは1–2、3–4の組で表示し、奇数末尾・1ページ資料は存在するページだけ返す", () => {
  assert.deepEqual(visiblePageNumbers(1, 5, true), [1, 2]);
  assert.deepEqual(visiblePageNumbers(2, 5, true), [1, 2]);
  assert.deepEqual(visiblePageNumbers(4, 5, true), [3, 4]);
  assert.deepEqual(visiblePageNumbers(5, 5, true), [5]);
  assert.deepEqual(visiblePageNumbers(1, 1, true), [1]);
  assert.deepEqual(visiblePageNumbers(1, 0, true), []);
  assert.deepEqual(visiblePageNumbers(2, 5, false), [2]);
});
test("見開きの前後送りは選択した側に関係なく組単位、先頭・末尾を超えない", () => {
  for (const current of [1, 2]) assert.equal(adjacentPageNumber(current, 5, true, 1), 3);
  for (const current of [3, 4]) assert.equal(adjacentPageNumber(current, 5, true, -1), 1);
  assert.equal(adjacentPageNumber(4, 5, true, 1), 5);
  assert.equal(adjacentPageNumber(5, 5, true, 1), 5);
  assert.equal(adjacentPageNumber(1, 5, true, -1), 1);
  assert.equal(adjacentPageNumber(2, 5, false, 1), 3);
  assert.equal(adjacentPageNumber(2, 5, false, -1), 1);
});
