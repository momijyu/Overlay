import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import fontkit from "@pdf-lib/fontkit";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { moveAnnotations, pasteAnnotations, decodeAnnotationClipboard, encodeAnnotationClipboard, type AnnotationContent } from "@/features/pdf-editor/annotationSelection";
import { saveLocalNote, loadLocalNote, captureNoteBackup, restoreNoteBackup, loadNoteLibrary } from "@/features/pdf-editor/localNotes";
import { encodeNoteBackup, decodeNoteBackup } from "@/features/pdf-editor/noteBackupFile";
import { readDriveManifest } from "@/features/pdf-editor/googleDriveNoteData";
import { exportAnnotatedPdf } from "@/features/pdf-editor/exportAnnotatedPdf";
import { textNoteLayout } from "@/features/pdf-editor/textLayout";
import { createShapeStroke, SHAPE_OPTIONS } from "@/features/pdf-editor/shapeStrokes";
import { fillEnclosedRegion } from "@/features/pdf-editor/fillRegion";

afterEach(() => mock.restoreAll());

test("穴のある塗りは移動・複製・端末保存・ZIP復元・Drive形式と回転PDF出力に残る", async () => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  const source = await PDFDocument.create(); source.addPage([600, 800]);
  const file = new File([new Uint8Array(await source.save())], "fill.pdf", { type: "application/pdf" });
  const boxes = [[.1, .1, .6, .6], [.25, .25, .4, .4]].map(([x, y, ex, ey]) => createShapeStroke("rectangle", { x, y }, { x: ex, y: ey }, 600, 800, 2, "#111827")!);
  const fill = fillEnclosedRegion(boxes, { x: .15, y: .15 }, 600, 800, "#ff0000");
  const content: AnnotationContent = { strokes: [fill], texts: [] }, bounds = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
  const moved = moveAnnotations(content, { strokes: [0], texts: [] }, { x: .1, y: .1 }, bounds, 600, 800);
  const copied = pasteAnnotations(moved, decodeAnnotationClipboard(encodeAnnotationClipboard(moved, 600, 800)), 600, 800, bounds).content;
  assert.equal(copied.strokes.length, 2);
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: { 1: copied.strokes }, textsByPage: {} });
  const backup = await decodeNoteBackup(await encodeNoteBackup(await captureNoteBackup({ kind: "note", id })));
  await restoreNoteBackup(backup);
  const restoredId = (await loadNoteLibrary()).notes.find((entry) => entry.id !== id)!.id;
  const restored = await loadLocalNote(restoredId);
  assert.deepEqual(restored.strokesByPage[1], copied.strokes);
  const manifest = readDriveManifest({ schemaVersion: 1, kind: "overlay-drive-note", noteKey: id, title: "塗り", fileName: file.name,
    pdfId: "source-pdf", pdfBytes: file.size, strokesByPage: restored.strokesByPage }, id);
  assert.deepEqual(manifest.strokesByPage, restored.strokesByPage);
  const displayed = { numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 800, height: 600,
    convertToPdfPoint: (x: number, y: number) => [y, x] }) }) } as unknown as PDFDocumentProxy;
  const result = await PDFDocument.load(await exportAnnotatedPdf(restored.file, displayed, restored.strokesByPage));
  const contents = result.getPage(0).node.Contents(); assert.ok(contents instanceof PDFArray);
  const operators = Array.from({ length: contents.size() }, (_, index) => {
    const stream = result.context.lookup(contents.get(index)); assert.ok(stream instanceof PDFRawStream);
    return new TextDecoder().decode(decodePDFRawStream(stream).decode());
  }).join("\n");
  assert.match(operators, /1 0 0 rg/); assert.equal([...operators.matchAll(/\nf\n/g)].length, 2);
  assert.deepEqual(new Uint8Array(await restored.file.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
});

test("極太の4図形は移動・コピー・端末保存・編集用復元・Drive形式とPDFに残る", async () => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  const source = await PDFDocument.create(); source.addPage([600, 800]);
  const file = new File([new Uint8Array(await source.save())], "shapes.pdf", { type: "application/pdf" });
  const content: AnnotationContent = { texts: [], strokes: SHAPE_OPTIONS.map(({ kind }) =>
    createShapeStroke(kind, { x: .2, y: .2 }, { x: .5, y: .5 }, 600, 800, 32, "#ff0000")!) };
  const bounds = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
  const moved = moveAnnotations(content, { strokes: [0, 1, 2, 3], texts: [] }, { x: .1, y: .1 }, bounds, 600, 800);
  const copied = pasteAnnotations(moved, decodeAnnotationClipboard(encodeAnnotationClipboard(moved, 600, 800)), 600, 800, bounds).content;
  assert.equal(copied.strokes.length, 8);
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: { 1: copied.strokes }, textsByPage: {} });
  const loaded = await loadLocalNote(id);
  assert.deepEqual(loaded.strokesByPage[1], copied.strokes);
  const backup = await decodeNoteBackup(await encodeNoteBackup(await captureNoteBackup({ kind: "note", id })));
  const note = backup.notes[0];
  const manifest = readDriveManifest({ schemaVersion: 1, kind: "overlay-drive-note", noteKey: id, title: note.title,
    fileName: note.fileName, pdfId: "source-pdf", pdfBytes: file.size, strokesByPage: note.strokesByPage }, id);
  assert.deepEqual(manifest.strokesByPage, loaded.strokesByPage);
  await restoreNoteBackup(backup);
  const restoredId = (await loadNoteLibrary()).notes.find((entry) => entry.id !== id)!.id;
  const restored = await loadLocalNote(restoredId);
  assert.deepEqual(restored.strokesByPage, loaded.strokesByPage);
  const displayed = { numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 600, height: 800,
    convertToPdfPoint: (x: number, y: number) => [x, 800 - y] }) }) } as unknown as PDFDocumentProxy;
  const result = await PDFDocument.load(await exportAnnotatedPdf(restored.file, displayed, restored.strokesByPage));
  const contents = result.getPage(0).node.Contents(); assert.ok(contents instanceof PDFArray);
  const operators = Array.from({ length: contents.size() }, (_, index) => {
    const stream = result.context.lookup(contents.get(index)); assert.ok(stream instanceof PDFRawStream);
    return new TextDecoder().decode(decodePDFRawStream(stream).decode());
  }).join("\n");
  assert.match(operators, /32 w/); assert.match(operators, /1 0 0 RG/);
  assert.ok([...operators.matchAll(/\sl\n/g)].length >= 140); // 閉じた輪郭・羽根も出力する。
  assert.deepEqual(new Uint8Array(await restored.file.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
});

test("移動・複製した線と文章は端末再読込・ZIP復元・Drive形式・PDF出力で保持する", async () => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  const bytes = new Uint8Array(readFileSync(new URL("../public/fonts/NotoSansJP-Regular.otf", import.meta.url)));
  mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => {
    assert.equal(url, "/fonts/NotoSansJP-Regular.otf"); return new Response(bytes);
  });
  const font = fontkit.create(bytes);
  const source = await PDFDocument.create(); source.addPage([600, 800]);
  const file = new File([new Uint8Array(await source.save())], "original.pdf", { type: "application/pdf" });
  const content: AnnotationContent = { strokes: [{ width: 3, color: "#ef4444", points: [{ x: .2, y: .2 }, { x: .3, y: .3 }] },
    { width: 12, color: "#ffff00", kind: "marker", points: [{ x: .2, y: .4 }, { x: .3, y: .4 }] }],
    texts: [{ id: "sticky", kind: "sticky", text: "付箋", x: .4, y: .2, width: .15, fontSize: 14, autoSize: true, backgroundColor: "#fff3b0" },
      { id: "text", kind: "text", text: "授業メモ", x: .2, y: .5, width: .2, fontSize: 14, autoSize: true }] };
  const bounds = (note: AnnotationContent["texts"][number]) => {
    const layout = textNoteLayout(note, 600, font, 800);
    return { left: note.x, top: note.y, right: note.x + layout.width / 600, bottom: note.y + layout.height / 800 };
  };
  const moved = moveAnnotations(content, { strokes: [0, 1], texts: ["sticky", "text"] }, { x: .1, y: .1 }, bounds, 600, 800);
  const copied = pasteAnnotations(moved, decodeAnnotationClipboard(encodeAnnotationClipboard(moved, 600, 800)), 600, 800, bounds);
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: { 1: copied.content.strokes }, textsByPage: { 1: copied.content.texts } });
  const loaded = await loadLocalNote(id);
  assert.ok(loaded.textsByPage);
  assert.deepEqual(loaded.strokesByPage[1], copied.content.strokes);
  assert.deepEqual(loaded.textsByPage[1], copied.content.texts);
  assert.equal(new Set(loaded.textsByPage[1].map((note) => note.id)).size, 4);
  const backup = await decodeNoteBackup(await encodeNoteBackup(await captureNoteBackup({ kind: "note", id })));
  const note = backup.notes[0];
  assert.deepEqual(note.strokesByPage, loaded.strokesByPage); assert.deepEqual(note.textsByPage, loaded.textsByPage);
  const manifest = readDriveManifest({ schemaVersion: 1, kind: "overlay-drive-note", noteKey: id, title: note.title,
    fileName: note.fileName, pdfId: "source-pdf", pdfBytes: file.size, strokesByPage: note.strokesByPage, textsByPage: note.textsByPage }, id);
  assert.deepEqual(manifest.textsByPage, loaded.textsByPage); assert.deepEqual(manifest.strokesByPage, loaded.strokesByPage);
  await restoreNoteBackup(backup);
  const restoredId = (await loadNoteLibrary()).notes.find((item) => item.id !== id)!.id;
  const restored = await loadLocalNote(restoredId);
  assert.deepEqual(restored.strokesByPage, loaded.strokesByPage); assert.deepEqual(restored.textsByPage, loaded.textsByPage);
  const displayed = { numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 600, height: 800,
    convertToPdfPoint: (x: number, y: number) => [x, 800 - y] }) }) } as unknown as PDFDocumentProxy;
  const result = await PDFDocument.load(await exportAnnotatedPdf(restored.file, displayed, restored.strokesByPage, restored.textsByPage));
  assert.equal(result.getPageCount(), 1); assert.ok(result.getPage(0).node.Contents());
  assert.deepEqual(new Uint8Array(await restored.file.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
});
