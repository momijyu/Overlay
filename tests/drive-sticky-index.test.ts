import assert from "node:assert/strict";
import test from "node:test";
import { readDriveStickyIndex, readStickyEntries } from "@/features/pdf-editor/driveStickyIndexData";

const source = { logicalId: "logical", noteId: "source", noteKey: "key", containerId: "container", deviceId: "device", fileName: "講義.pdf" };
const entry = { pageId: 7, pageNumber: 2, textId: "付箋:7", label: "試験範囲" };
const index = { schemaVersion: 1, kind: "overlay-sticky-index", logicalId: "logical", sourceId: "source", noteKey: "key", deviceId: "device", generation: 3, entries: [entry] };

test("付箋索引は白紙挿入後のページID・表示番号を維持し、座標・全文や取得先を取り込まない", () => {
  const parsed = readDriveStickyIndex({ ...index, entries: [{ ...entry, x: .5, text: "長文", sourceId: "wrong" }] }, source);
  assert.deepEqual(parsed, index);
  assert.deepEqual(readStickyEntries([]), []);
  assert.equal(readStickyEntries([{ ...entry, label: "あ".repeat(120) }])[0].label.length, 120);
});

test("索引のID・形式・世代を検証し、異なるノート・端末へ移動しない", () => {
  for (const invalid of [null, { ...index, schemaVersion: 2 }, { ...index, kind: "other" },
    { ...index, logicalId: "other" }, { ...index, sourceId: "other" }, { ...index, noteKey: "other" },
    { ...index, deviceId: "other" }, { ...index, generation: 0 }, { ...index, generation: 1.5 }]) {
    assert.throws(() => readDriveStickyIndex(invalid, source));
  }
});

test("不正な付箋件数・番号・重複・長さ・制御文字を拒否する", () => {
  for (const invalid of [undefined, {}, Array(10001).fill(entry), [entry, entry], [{ ...entry, pageId: 0 }],
    [{ ...entry, pageNumber: 1.2 }], [{ ...entry, pageId: Number.MAX_SAFE_INTEGER + 1 }],
    [{ ...entry, textId: "" }], [{ ...entry, textId: "x".repeat(101) }], [{ ...entry, label: "" }],
    [{ ...entry, label: "a\nb" }], [{ ...entry, label: "x".repeat(121) }]]) {
    assert.throws(() => readStickyEntries(invalid));
  }
});
