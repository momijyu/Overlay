import assert from "node:assert/strict";
import test from "node:test";
import { parsePdfPageSelection, validatePdfPageSelection } from "@/features/pdf-editor/pdfPageSelection";

test("単ページ・範囲・重複・全角入力を現在のページ順にまとめる", () => {
  assert.deepEqual(parsePdfPageSelection("5, 1, 3-5, 1", 5), [1, 3, 4, 5]);
  assert.deepEqual(parsePdfPageSelection("１、３－５", 5), [1, 3, 4, 5]);
  assert.deepEqual(parsePdfPageSelection(" 2 - 2 ", 2), [2]);
  const input = [3, 1, 3];
  assert.deepEqual(validatePdfPageSelection(input, 3), [1, 3]);
  assert.deepEqual(input, [3, 1, 3]);
});

test("空・逆順・範囲外・整数以外・壊れた区切りを拒否し、巨大な範囲を展開しない", () => {
  for (const value of ["", " ", "0", "-1", "1.5", "4", "3-2", "1,", "1,,2", "1-2-3", "1 2", "1e2", "1-99999999999999999"]) {
    assert.throws(() => parsePdfPageSelection(value, 3), value);
  }
  assert.throws(() => parsePdfPageSelection("1".repeat(60001), 3));
  for (const value of [[], [NaN], [Infinity], [0], [1.1], [4], Array(2)]) assert.throws(() => validatePdfPageSelection(value, 3));
  for (const count of [0, -1, 1.1, Infinity, 10001]) assert.throws(() => parsePdfPageSelection("1", count));
});
