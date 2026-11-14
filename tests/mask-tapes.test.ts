import assert from "node:assert/strict";
import test from "node:test";
import { readMaskTapes, MAX_MASK_TAPES, tapeRectangle, moveTape } from "@/features/pdf-editor/maskTapes";
import { createStrokeHistory, recordTapeEdit, recordStrokeEdit, recordPageDeletion, recordPageClear, undoStrokeEdit, redoStrokeEdit } from "@/features/pdf-editor/strokeHistory";
import { readDriveManifest } from "@/features/pdf-editor/googleDriveNoteData";
import { driveManifestContent } from "@/features/pdf-editor/driveAutosaveRemote";
const tape = { id: "answer", x: .1, y: .2, width: .3, height: .04 };

test("旧ノートはテープなしで開き、不正な矩形・重複ID・件数超過は拒否する", () => {
  assert.equal(readMaskTapes(undefined), undefined);
  assert.deepEqual(readMaskTapes({ 1: [{ ...tape, revealed: true }] }), { 1: [tape] });
  for (const input of [null, [], { 0: [tape] }, { 1: [tape, tape] }, { 1: [{ ...tape, width: 0 }] },
    { 1: [{ ...tape, x: -.1 }] }, { 1: [{ ...tape, height: NaN }] }, { 1: [{ ...tape, x: .9 }] },
    { 1: Array.from({ length: MAX_MASK_TAPES + 1 }, (_, i) => ({ ...tape, id: String(i) })) }]) {
    assert.throws(() => readMaskTapes(input), /目隠しテープ/);
  }
});

test("逆向きのドラッグとページ外への移動をページ内に収める", () => {
  assert.deepEqual(tapeRectangle({ x: .6, y: .8 }, { x: -.1, y: .2 }), { x: 0, y: .2, width: .6, height: .6000000000000001 });
  assert.deepEqual(moveTape(tape, 2, -2), { ...tape, x: .7, y: 0 });
});

test("線とテープの混在履歴・テープ削除・ページ削除を元に戻せる", () => {
  const empty = createStrokeHistory({});
  const added = recordTapeEdit(empty, 1, [tape]);
  const drawn = recordStrokeEdit(added, 1, [{ width: .01, points: [{ x: .5, y: .5 }] }]);
  assert.deepEqual(undoStrokeEdit(drawn).tapesByPage, added.tapesByPage);
  assert.equal(undoStrokeEdit(added).tapesByPage, undefined);
  assert.deepEqual(redoStrokeEdit(undoStrokeEdit(added)).tapesByPage, added.tapesByPage);
  const cleared = recordPageClear(drawn, 1, { strokes: false, sticky: false, text: false, tapes: true });
  assert.deepEqual(cleared.tapesByPage, { 1: [] });
  assert.equal(cleared.strokesByPage, drawn.strokesByPage);
  assert.deepEqual(undoStrokeEdit(cleared).tapesByPage, added.tapesByPage);
  const pages = [{ id: 1, kind: "pdf" as const, pageNumber: 1 }, { id: 2, kind: "pdf" as const, pageNumber: 2 }];
  const deleted = recordPageDeletion(drawn, pages, 1);
  assert.deepEqual(deleted.tapesByPage, {});
  assert.deepEqual(undoStrokeEdit(deleted).tapesByPage, added.tapesByPage);
});

test("Drive版6はテープを検証し内容ハッシュの対象に含め、旧版へ紛れたテープは拒否する", () => {
  const data = { schemaVersion: 6, kind: "overlay-drive-note", noteKey: "note_A", title: "復習", fileName: "lecture.pdf", pdfId: "pdf_A", pdfBytes: 100,
    strokesByPage: {}, textsByPage: {}, tapesByPage: { 1: [tape] } };
  const manifest = readDriveManifest(data, "note_A");
  assert.deepEqual(manifest.tapesByPage, data.tapesByPage);
  assert.deepEqual(driveManifestContent(manifest).tapesByPage, data.tapesByPage);
  assert.throws(() => readDriveManifest({ ...data, schemaVersion: 5 }, "note_A"), /目隠しテープ/);
  const old = readDriveManifest({ ...data, schemaVersion: 1, tapesByPage: undefined }, "note_A");
  assert.equal("tapesByPage" in driveManifestContent(old), false);
});
