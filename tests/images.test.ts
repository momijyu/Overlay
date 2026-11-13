import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { PDFDocument } from "pdf-lib";
import { unzipSync, zipSync } from "fflate";
import { cropImage, imageHash, imageMatrix, importImage, inspectRaster, readNoteImages, resizeImage, rotateImage, verifyImageAssets, IMAGE_LIMITS } from "@/features/pdf-editor/imageData";
import { imageFixture, testPng } from "./image-fixture";
import { createStrokeHistory, recordImageEdit, recordStrokeEdit, recordPageDeletion, undoStrokeEdit, redoStrokeEdit } from "@/features/pdf-editor/strokeHistory";
import { saveLocalNote, loadLocalNote, captureNoteBackup, restoreNoteBackup, deleteSavedNote, loadNoteLibrary } from "@/features/pdf-editor/localNotes";
import { createLocalAutosave, type LocalSaveInput } from "@/features/pdf-editor/localAutosave";
import { encodeNoteBackup, decodeNoteBackup } from "@/features/pdf-editor/noteBackupFile";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
import { readNoteBackup, type NoteBackup } from "@/features/pdf-editor/noteBackupData";

beforeEach(() => { Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() }); });
afterEach(() => mock.restoreAll());
async function pdfFile() { const pdf = await PDFDocument.create(); pdf.addPage([200, 200]); pdf.addPage([200, 200]); return new File([new Uint8Array(await pdf.save())], "画像.pdf", { type: "application/pdf" }); }

test("元PNGのバイト列を維持し、デコード前に形式・寸法・容量を拒否する", async () => {
  assert.deepEqual(await inspectRaster(testPng()), { width: 2, height: 2, type: "image/png", oriented: false });
  const bytes = new Uint8Array(await testPng().arrayBuffer());
  new DataView(bytes.buffer).setUint32(16, 9000);
  await assert.rejects(inspectRaster(new Blob([bytes])), /画素|8,192/);
  await assert.rejects(inspectRaster(new Blob(["<svg></svg>"])), /PNG・JPEG/);
  await assert.rejects(inspectRaster(new Blob([new Uint8Array(IMAGE_LIMITS.bytes + 1)])), /20MiB/);
  let closed = false;
  Object.defineProperty(globalThis, "createImageBitmap", { configurable: true, writable: true, value: async () => ({ width: 2, height: 2, close() { closed = true; } }) });
  const imported = await importImage(testPng());
  assert.deepEqual(await imported.asset.blob.arrayBuffer(), await testPng().arrayBuffer());
  assert.equal(imported.id, await imageHash(testPng())); assert.equal(closed, true);
});

test("画像の欠落・改変・不正な配置・大量画素を拒否する", async () => {
  const data = await imageFixture(), id = Object.keys(data.assets)[0];
  await verifyImageAssets(data);
  assert.throws(() => readNoteImages({ ...data, assets: {} }), /元画像/);
  assert.throws(() => readNoteImages({ ...data, byPage: { 1: [{ ...data.byPage[1][0], x: .9 }] } }), /範囲/);
  assert.throws(() => readNoteImages({ ...data, byPage: { 1: [data.byPage[1][0], data.byPage[1][0]] } }), /識別/);
  assert.throws(() => readNoteImages({ ...data, assets: Object.fromEntries(["a", "b", "c"].map((n) => [n.repeat(64), { blob: testPng(), width: 4000, height: 4000 }])) }), /3,200万/);
  await assert.rejects(verifyImageAssets({ ...data, assets: { [id]: { ...data.assets[id], blob: new Blob(["bad"], { type: "image/png" }) } } }));
});

test("回転・切り抜き・リサイズで縦横比とページ内配置を維持する", async () => {
  const data = await imageFixture(), original = data.byPage[1][0], asset = data.assets[original.assetId];
  const rotated = rotateImage(original, 600, 800);
  assert.equal(rotated.rotation, 90); assert.equal(rotated.width * 600, original.height * 800);
  const resized = resizeImage(original, 20, 20);
  assert.ok(resized.x + resized.width <= 1 && resized.y + resized.height <= 1);
  assert.equal(resized.width / resized.height, original.width / original.height);
  const tiny = resizeImage(original, -20, -20); assert.ok(tiny.width >= .0001 && tiny.height >= .0001);
  const crop = cropImage(original, { x: .5, y: 0, width: .5, height: 1 }, asset, 200, 200);
  assert.equal(crop.width / crop.height, .5);
  for (const rotation of [0, 90, 180, 270] as const) {
    const image = { ...original, crop: { x: .5, y: 0, width: .5, height: 1 }, rotation };
    const m = imageMatrix(image, asset, 200, 200);
    const corners = [[1,0],[2,0],[1,2],[2,2]].map(([x,y]) => [m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f]);
    assert.equal(Math.min(...corners.map(([x]) => x)), 20); assert.equal(Math.max(...corners.map(([x]) => x)), 100);
    assert.equal(Math.min(...corners.map(([,y]) => y)), 20); assert.equal(Math.max(...corners.map(([,y]) => y)), 100);
  }
});

test("画像追加・移動・削除・ページ削除をUndo/Redoでき、元画像Blobを複製しない", async () => {
  const images = await imageFixture(), id = Object.keys(images.assets)[0];
  const base = createStrokeHistory({}, {}, [{ id: 1, kind: "pdf", pageNumber: 1 }, { id: 2, kind: "pdf", pageNumber: 2 }]);
  const added = recordImageEdit(base, 1, images);
  assert.equal(undoStrokeEdit(added).images, undefined);
  assert.equal(redoStrokeEdit(undoStrokeEdit(added)).images?.assets[id].blob, images.assets[id].blob);
  const moved = recordImageEdit(added, 1, { ...images, byPage: { 1: [{ ...images.byPage[1][0], x: .2 }] } });
  assert.equal(moved.images?.assets[id].blob, images.assets[id].blob);
  const pen = recordStrokeEdit(moved, 1, [{ width: 1, points: [{ x: .5, y: .5 }] }]);
  assert.equal(pen.images, moved.images);
  const deleted = recordPageDeletion(pen, pen.pages!, 1);
  assert.deepEqual(deleted.images?.assets, {}); assert.equal(undoStrokeEdit(deleted).images, moved.images);
  assert.deepEqual(recordImageEdit(moved, 1, { ...images, byPage: { 1: [] } }).images?.assets, {});
});

test("画像だけの変更を初回自動保存し、Undoで画像を除いた状態も保存する", async () => {
  const file = await pdfFile(), images = await imageFixture(), strokes = {}, texts = {}, inputs: LocalSaveInput[] = [];
  const auto = createLocalAutosave({ file, noteId: null, strokesByPage: strokes, textsByPage: texts, persist: async (input) => { inputs.push(input); return "id"; }, onChange() {} });
  assert.equal(auto.hasPendingChanges(), false);
  auto.update(strokes, texts, undefined, {}, images); await auto.flush();
  assert.equal(inputs[0].images, images);
  auto.update(strokes, texts, undefined, {}, undefined); await auto.flush();
  assert.equal(inputs.at(-1)?.images, undefined); assert.equal(auto.hasPendingChanges(), false); auto.dispose();
});

test("ローカル保存・更新・復元・削除に画像を含め、画像なし旧ノートも開ける", async () => {
  const file = await pdfFile(), images = await imageFixture();
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: {}, images });
  const loaded = await loadLocalNote(id); assert.deepEqual(loaded.images?.byPage, images.byPage);
  await verifyImageAssets(loaded.images);
  await saveLocalNote({ file, noteId: id, expectedRevision: loaded.revision, strokesByPage: { 1: [{ width: 1, points: [{ x: .2, y: .2 }] }] } });
  assert.deepEqual((await loadLocalNote(id)).images?.byPage, images.byPage);
  const backup = await captureNoteBackup({ kind: "note", id }); assert.equal(backup.schemaVersion, 5);
  await deleteSavedNote(id); await restoreNoteBackup(backup);
  const restored = (await loadNoteLibrary()).notes[0]; await verifyImageAssets((await loadLocalNote(restored.id)).images);
  await deleteSavedNote(restored.id);
  const count = await withLocalTransaction(["notes", "pdfs"], "readonly", async (tx) => [await readRequest(tx.objectStore("notes").count()), await readRequest(tx.objectStore("pdfs").count())]);
  assert.deepEqual(count, [0, 0]);
  const old = await saveLocalNote({ file, noteId: null, strokesByPage: {} }); assert.equal((await loadLocalNote(old)).images, undefined);
});

test("画像付きZIPを別バイナリで復元し、欠落・改変・旧形式への混入を拒否する", async () => {
  const images = await imageFixture(), file = await pdfFile();
  const backup: NoteBackup = { schemaVersion: 5, kind: "note", name: "画像", folders: [], notes: [{ id: "a", title: "画像", fileName: file.name, folderId: null, pdf: file, strokesByPage: {}, textsByPage: {}, images }] };
  const encoded = await encodeNoteBackup(backup), entries = unzipSync(new Uint8Array(await encoded.arrayBuffer()));
  const names = Object.keys(entries).filter((n) => n.startsWith("images/")); assert.equal(names.length, 1);
  assert.ok(!new TextDecoder().decode(entries["manifest.json"]).includes("base64"));
  const decoded = await decodeNoteBackup(encoded); await verifyImageAssets(decoded.notes[0].images);
  assert.deepEqual(decoded.notes[0].images?.byPage, images.byPage);
  entries[names[0]][entries[names[0]].length - 1] ^= 1;
  await assert.rejects(decodeNoteBackup(new Blob([zipSync(entries, { level: 0 })])));
  delete entries[names[0]]; await assert.rejects(decodeNoteBackup(new Blob([zipSync(entries, { level: 0 })])));
  assert.throws(() => readNoteBackup({ ...backup, schemaVersion: 4 }));
});
