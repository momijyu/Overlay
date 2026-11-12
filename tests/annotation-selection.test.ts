import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { annotationBounds, decodeAnnotationClipboard, encodeAnnotationClipboard, moveAnnotations, pasteAnnotations, selectAnnotations, selectedContent, MAX_SELECTION_BYTES, type AnnotationContent } from "@/features/pdf-editor/annotationSelection";
import { textNoteLayout } from "@/features/pdf-editor/textLayout";
import { createStrokeHistory, recordAnnotationEdit, undoStrokeEdit, redoStrokeEdit } from "@/features/pdf-editor/strokeHistory";
import type { PenPoint, TextNote } from "@/features/pdf-editor/types";

const font = fontkit.create(new Uint8Array(readFileSync(new URL("../public/fonts/NotoSansJP-Regular.otf", import.meta.url))));
const text: TextNote = { id: "text", kind: "text", text: "授業メモ", x: .2, y: .25, width: .2, fontSize: 14, autoSize: true };
const content: AnnotationContent = { strokes: [{ width: 3, color: "#123456", points: [{ x: .2, y: .2 }, { x: .3, y: .3 }] },
  { width: 12, kind: "marker", color: "#ffff00", points: [{ x: .7, y: .2 }, { x: .8, y: .2 }] }],
  texts: [text, { ...text, id: "sticky", kind: "sticky", y: .4, backgroundColor: "#fff3b0" }] };
const rect = (x: number, y: number, r: number, b: number): PenPoint[] => [{ x, y }, { x: r, y }, { x: r, y: b }, { x, y: b }];
const textBounds = (note: TextNote) => ({ left: note.x, top: note.y, right: note.x + note.width,
  bottom: note.y + textNoteLayout(note, 600, font, 800).height / 800 });
const selection = { strokes: [0], texts: ["text", "sticky"] };

test("投げ縄は線全体・文章の箱全体を選択し、部分的にかかった対象を残す", () => {
  assert.deepEqual(selectAnnotations(content, rect(.1, .1, .5, .6), textBounds), selection);
  assert.deepEqual(selectAnnotations(content, rect(.1, .1, .25, .6), textBounds), { strokes: [], texts: [] });
  assert.deepEqual(selectAnnotations(content, rect(.65, .15, .85, .25), textBounds), { strokes: [1], texts: [] });
  assert.deepEqual(selectAnnotations(content, [], textBounds), { strokes: [], texts: [] });
});

test("凹んだ輪郭・対角線をまたぐ線は、外接四角や両端だけで選択しない", () => {
  const polygon = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: .6, y: 1 }, { x: .6, y: .3 }, { x: .4, y: .3 }, { x: .4, y: 1 }, { x: 0, y: 1 }];
  const source = { strokes: [{ width: 1, points: [{ x: .2, y: .6 }, { x: .8, y: .6 }] }], texts: [] };
  assert.deepEqual(selectAnnotations(source, polygon, textBounds).strokes, []);
  assert.deepEqual(selectAnnotations({ strokes: [{ width: 1, points: [{ x: .8, y: .8 }] }], texts: [] },
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], textBounds).strokes, []);
});

test("点の線・境界上を選べ、空の線は選ばない", () => {
  const source = { strokes: [{ width: 1, points: [{ x: .2, y: .2 }] }, { width: 1, points: [] }], texts: [] };
  assert.deepEqual(selectAnnotations(source, rect(.2, .2, .3, .3), textBounds).strokes, [0]);
});

test("選択をまとめてページ端へ制限し、間隔・色・太さ・元配列・未選択項目を維持", () => {
  const before = structuredClone(content);
  const next = moveAnnotations(content, selection, { x: 5, y: 5 }, textBounds, 600, 800);
  const dx = next.texts[0].x - text.x, dy = next.texts[0].y - text.y;
  assert.ok(dx > 0 && dy > 0);
  assert.ok(Math.abs(next.strokes[0].points[0].x - .2 - dx) < 1e-9);
  assert.ok(Math.abs(next.texts[1].y - .4 - dy) < 1e-9);
  assert.equal(next.strokes[1], content.strokes[1]);
  assert.equal(next.strokes[0].width, 3); assert.equal(next.strokes[0].color, "#123456");
  assert.deepEqual(content, before);
  const b = annotationBounds(selectedContent(next, selection), textBounds, 600, 800)!;
  assert.ok(b.right <= 1.00000001 && b.bottom <= 1.00000001);
  assert.equal(moveAnnotations(content, selection, { x: 0, y: 0 }, textBounds, 600, 800), content);
  assert.equal(moveAnnotations(content, { strokes: [], texts: [] }, { x: .1, y: .1 }, textBounds, 600, 800), content);
});

test("旧テキストの幅・高さ・autoSize設定を移動だけでは変えない", () => {
  const old = { ...text, autoSize: undefined, height: .2 };
  const next = moveAnnotations({ strokes: [], texts: [old] }, { strokes: [], texts: ["text"] }, { x: .1, y: .1 }, textBounds, 600, 800);
  assert.equal(next.texts[0].width, old.width); assert.equal(next.texts[0].height, old.height);
  assert.equal(next.texts[0].autoSize, undefined);
});

test("コピーは内容を検証し、新しいIDで追記、連続貼り付けも既存を上書きしない", () => {
  const source = selectedContent(content, selection);
  const copied = decodeAnnotationClipboard(encodeAnnotationClipboard(source, 600, 800));
  let id = 0;
  const first = pasteAnnotations(content, copied, 600, 800, textBounds, () => `new-${++id}`);
  const second = pasteAnnotations(first.content, copied, 600, 800, textBounds, () => `new-${++id}`);
  assert.equal(second.content.strokes.length, 4); assert.equal(second.content.texts.length, 6);
  assert.equal(new Set(second.content.texts.map((note) => note.id)).size, 6);
  assert.deepEqual(first.selection, { strokes: [2], texts: ["new-1", "new-2"] });
  assert.equal(first.content.strokes[0], content.strokes[0]); assert.equal(first.content.texts[0], text);
  assert.equal(first.content.texts[2].text, text.text); assert.equal(first.content.texts[3].backgroundColor, "#fff3b0");
});

test("違う寸法のページにもPDF単位の大きさを維持し、入らない場合は中止", () => {
  const copied = decodeAnnotationClipboard(encodeAnnotationClipboard(selectedContent(content, selection), 600, 800));
  const targetBounds = (note: TextNote) => ({ left: note.x, top: note.y, right: note.x + note.width,
    bottom: note.y + textNoteLayout(note, 1200, font, 1600).height / 1600 });
  const next = pasteAnnotations({ strokes: [], texts: [] }, copied, 1200, 1600, targetBounds);
  assert.equal(next.content.texts[0].fontSize, text.fontSize);
  assert.equal(next.content.texts[0].width * 1200, text.width * 600);
  assert.equal(next.content.strokes[0].width, 3);
  assert.throws(() => pasteAnnotations(content, copied, 100, 100, textBounds), /収まりません|幅が足りません/);
});

test("壊れた・過大な外部クリップボードは既存内容を変更せず拒否", () => {
  const valid = JSON.parse(encodeAnnotationClipboard(content, 600, 800));
  for (const value of ["{", "x".repeat(MAX_SELECTION_BYTES + 1), JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, width: 0 }), JSON.stringify({ ...valid, strokes: [null] }),
    JSON.stringify({ ...valid, texts: [text, text] }), JSON.stringify({ ...valid, texts: [{ ...text, x: -1 }] }),
    JSON.stringify({ ...valid, strokes: Array(1001).fill(valid.strokes[0]) }),
    JSON.stringify({ ...valid, strokes: [{ width: 1, points: Array(100001).fill({ x: 0, y: 0 }) }] })]) {
    assert.throws(() => decodeAnnotationClipboard(value));
  }
});

test("移動・貼り付けは混在内容を1操作でUndo / Redoし、別ページを保持", () => {
  const start = createStrokeHistory({ 1: content.strokes, 2: content.strokes }, { 1: content.texts, 2: content.texts });
  const moved = moveAnnotations(content, selection, { x: .1, y: .1 }, textBounds, 600, 800);
  const history = recordAnnotationEdit(start, 1, moved.strokes, moved.texts);
  assert.equal(history.past.length, 1); assert.equal(history.version, 1);
  assert.equal(history.strokesByPage[2], start.strokesByPage[2]); assert.equal(history.textsByPage[2], start.textsByPage[2]);
  const undone = undoStrokeEdit(history); assert.equal(undone.strokesByPage, start.strokesByPage); assert.equal(undone.textsByPage, start.textsByPage);
  assert.equal(redoStrokeEdit(undone).textsByPage, history.textsByPage);
  assert.equal(recordAnnotationEdit(start, 1, content.strokes, content.texts), start);
  assert.equal(recordAnnotationEdit(start, 0, content.strokes, content.texts), start);
});
