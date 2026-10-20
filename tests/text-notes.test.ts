import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readTextNotes, normalizeNoteText } from "@/features/pdf-editor/textData";
import { fitTextNote, textNoteLayout } from "@/features/pdf-editor/textLayout";
import { loadNoteFont } from "@/features/pdf-editor/noteFont";
import { createStrokeHistory, recordStrokeEdit, recordTextEdit, undoStrokeEdit, redoStrokeEdit } from "@/features/pdf-editor/strokeHistory";
import { exportAnnotatedPdf } from "@/features/pdf-editor/exportAnnotatedPdf";
import type { TextNote, TextNotesByPage } from "@/features/pdf-editor/types";

const bytes = new Uint8Array(readFileSync(new URL("../public/fonts/NotoSansJP-Regular.otf", import.meta.url)));
const font = fontkit.create(bytes);
const note: TextNote = { id: "text-1", kind: "text", text: "授業のメモ", x: 0.1, y: 0.1, width: 0.5, fontSize: 14 };
afterEach(() => mock.restoreAll());

test("旧ノートは空テキストとして扱い、新データは日本語・付箋を複製して復元する", () => {
  assert.deepEqual(readTextNotes(undefined), {});
  const source = { 1: [note, { ...note, id: "sticky", kind: "sticky" as const, text: "復習\n重要" }] };
  const result = readTextNotes(source);
  assert.deepEqual(result, source);
  assert.notEqual(result[1], source[1]);
  assert.notEqual(result[1][0], source[1][0]);
  assert.equal(normalizeNoteText("授業\r\nメモ\t重要\r次"), "授業\nメモ    重要\n次");
});

test("不正なページ・重複ID・内容・座標・幅・文字サイズを保存前に拒否する", () => {
  for (const value of [null, [], { 0: [note] }, { "1.5": [note] }, { 1: [note, note] }]) assert.throws(() => readTextNotes(value), /テキスト情報/);
  for (const change of [{ id: "" }, { kind: "unknown" }, { text: " " }, { text: "x".repeat(2001) }, { text: "a\0b" },
    { x: NaN }, { x: -1 }, { x: 1 }, { y: Infinity }, { y: 1 }, { width: 0 }, { width: 1 }, { fontSize: 0 }, { fontSize: 49 }]) {
    assert.throws(() => readTextNotes({ 1: [{ ...note, ...change }] }), /テキスト情報/);
  }
});

test("同梱フォントの実際の幅で折り返し、空行・改行・全ての文字を維持する", () => {
  const text = "日本語abc長い文章\n\n復習";
  const layout = textNoteLayout({ ...note, text, width: 0.15 }, 400, font);
  assert.ok(layout.lines.length > 4);
  assert.equal(layout.lines.join(""), text.replaceAll("\n", ""));
  assert.ok(layout.lines.includes(""));
  assert.ok(layout.height > 14);
  assert.deepEqual(layout, textNoteLayout({ ...note, text, width: 0.15 }, 400, font));
});

test("長文は日本語フォントのglyph計算を文字数分で済ませる", () => {
  let layouts = 0;
  const measured = Object.create(font) as typeof font;
  measured.layout = (...args) => { layouts++; return font.layout(...args); };
  textNoteLayout({ ...note, text: "長".repeat(1000) }, 400, measured);
  assert.ok(layouts <= 2000);
});

test("ページ端の位置を補正し、ページを超える文章や未対応文字を拒否する", () => {
  const fitted = fitTextNote({ ...note, x: 0.9, y: 0.99 }, 400, 600, font);
  assert.equal(fitted.x, 0.5);
  assert.ok(fitted.y < 0.99);
  assert.ok(fitted.y * 600 + textNoteLayout(fitted, 400, font).height <= 600.001);
  assert.throws(() => fitTextNote({ ...note, text: "多\n".repeat(100) }, 400, 600, font), /ページの高さ/);
  assert.throws(() => textNoteLayout({ ...note, text: "😀" }, 400, font), /この文字はPDFに出力できません/);
});

test("任意の高さを保存し、旧ボックスは内容高、新ボックスは内容高以上で表示する", () => {
  const resized = { ...note, height: 0.3 };
  assert.deepEqual(readTextNotes({ 1: [resized] })[1][0], resized);
  assert.equal(textNoteLayout(resized, 400, font, 600).height, 180);
  assert.equal(textNoteLayout(note, 400, font, 600).height, textNoteLayout(note, 400, font).contentHeight);
  const long = textNoteLayout({ ...resized, text: "授業\n".repeat(15) }, 400, font, 600);
  assert.ok(long.height >= long.contentHeight);
  for (const height of [0, -0.1, Infinity, NaN, 1, "0.3", null]) {
    assert.throws(() => readTextNotes({ 1: [{ ...note, height }] }), /テキスト情報/);
  }
  assert.throws(() => readTextNotes({ 1: [{ ...resized, kind: "sticky" }] }), /テキスト情報/);
});

test("文字サイズに合わせて幅・高さを計算し、古い手動の高さを外す", () => {
  const source = { ...note, text: "文字に合わせるボックス", x: 0.9, y: 0.95, height: 0.04, autoSize: true };
  const small = fitTextNote({ ...source, fontSize: 12 }, 400, 600, font);
  const large = fitTextNote({ ...source, fontSize: 32 }, 400, 600, font);
  assert.ok(large.width > small.width);
  assert.ok(textNoteLayout(large, 400, font, 600).height > textNoteLayout(small, 400, font, 600).height);
  assert.equal(large.height, undefined);
  assert.ok(large.x + large.width <= 1.000001);
  assert.ok(large.y * 600 + textNoteLayout(large, 400, font, 600).height <= 600.001);
  assert.deepEqual(readTextNotes({ 1: [large] })[1][0], large);
  assert.deepEqual(source.height, 0.04);
});

test("内容が短くなると箱も縮み、長い行と明示改行はページ内で折り返す", () => {
  const source = { ...note, autoSize: true, fontSize: 24 };
  const long = fitTextNote({ ...source, text: "長い文章".repeat(8) + "\n次の行" }, 400, 600, font);
  const short = fitTextNote({ ...long, text: "短い" }, 400, 600, font);
  assert.ok(short.width < long.width);
  assert.ok(textNoteLayout(short, 400, font, 600).height < textNoteLayout(long, 400, font, 600).height);
  assert.ok(textNoteLayout(long, 400, font, 600).lines.length > 2);
  assert.equal(textNoteLayout(short, 400, font, 600).lines.length, 1);
  assert.throws(() => fitTextNote({ ...source, text: "行\n".repeat(100) }, 400, 600, font), /ページの高さ/);
  for (const autoSize of [null, "yes", 1]) assert.throws(() => readTextNotes({ 1: [{ ...note, autoSize }] }), /テキスト情報/);
  const sticky = fitTextNote({ ...source, kind: "sticky", text: "付箋も自動調整" }, 400, 600, font);
  assert.equal(sticky.kind, "sticky");
  assert.deepEqual(readTextNotes({ 1: [sticky] })[1][0], sticky);
});

test("ペンと文章・移動・付箋削除の履歴を同じ順序で戻し、やり直し・枝分かれできる", () => {
  const empty = createStrokeHistory({});
  const added = recordTextEdit(empty, 1, [note]);
  const drawn = recordStrokeEdit(added, 2, [{ width: 2, points: [{ x: 0.5, y: 0.5 }] }]);
  const moved = recordTextEdit(drawn, 1, [{ ...note, x: 0.3, text: "変更" }]);
  const removed = recordTextEdit(moved, 1, []);
  const back = undoStrokeEdit(removed);
  assert.equal(back.textsByPage, moved.textsByPage);
  assert.equal(undoStrokeEdit(back).textsByPage, added.textsByPage);
  assert.equal(undoStrokeEdit(undoStrokeEdit(back)).strokesByPage, empty.strokesByPage);
  assert.equal(redoStrokeEdit(back).textsByPage, removed.textsByPage);
  const branch = recordTextEdit(back, 2, [{ ...note, kind: "sticky" }]);
  assert.equal(branch.future.length, 0);
  assert.equal(branch.strokesByPage, moved.strokesByPage);
});

test("フォント取得の失敗後は再試行でき、成功後は同じ読み込みを使い回す", async () => {
  const failed = mock.method(globalThis, "fetch", async () => new Response(null, { status: 500 }));
  await assert.rejects(loadNoteFont(), /日本語フォント/);
  failed.mock.restore();
  const success = mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => {
    assert.equal(url, "/fonts/NotoSansJP-Regular.otf");
    return new Response(bytes);
  });
  const first = loadNoteFont();
  assert.equal(loadNoteFont(), first);
  assert.equal((await first).font.fullName, "Noto Sans JP");
  assert.equal(loadNoteFont(), first);
  assert.equal(success.mock.callCount(), 1);
});

test("実PDFの日本語・付箋・改行を0/90/180/270度で出力し、文字として再抽出できる", async () => {
  const source = await PDFDocument.create();
  for (const angle of [0, 90, 180, 270]) {
    const page = source.addPage([400, 600]);
    page.setRotation(degrees(angle));
    page.drawText("Original", { x: 10, y: 10, size: 10 });
  }
  const original = new Uint8Array(await source.save());
  const file = new File([original], "notes.pdf");
  const displayed = await getDocument({ data: original.slice(), disableFontFace: true }).promise;
  try {
    const texts: TextNotesByPage = {};
    for (const page of [1, 2, 3, 4]) {
      const viewport = (await displayed.getPage(page)).getViewport({ scale: 1 });
      texts[page] = [fitTextNote({ ...note, fontSize: 28, autoSize: true }, viewport.width, viewport.height, font),
        fitTextNote({ ...note, id: "sticky", kind: "sticky", y: 0.4, text: "付箋\n要復習", fontSize: 24, autoSize: true }, viewport.width, viewport.height, font)];
    }
    const output = await exportAnnotatedPdf(file, displayed, {}, texts);
    assert.ok(output.length < 5000000); // フォントをPDF内で共有し、ページごとには複製しない。
    const result = await getDocument({ data: output.slice(), disableFontFace: true }).promise;
    try {
      for (let page = 1; page <= 4; page++) {
        const resultPage = await result.getPage(page);
        const content = await resultPage.getTextContent();
        const text = content.items.flatMap((item) => "str" in item ? [item.str] : []).join("");
        assert.match(text, /Original/);
        assert.match(text, /授業のメモ/);
        assert.match(text, /付箋/);
        assert.match(text, /要復習/);
        const item = content.items.find((item) => "str" in item && item.str === note.text);
        assert.ok(item && "transform" in item);
        const viewport = resultPage.getViewport({ scale: 1 });
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const exported = texts[page][0];
        const layout = textNoteLayout(exported, viewport.width, font);
        assert.ok(Math.abs(Math.hypot(item.transform[0], item.transform[1]) - 28) < 0.001);
        assert.ok(Math.abs(x - (exported.x * viewport.width + 6)) < 0.001);
        assert.ok(Math.abs(y - (exported.y * viewport.height + layout.baseline)) < 0.001);
        const stickyText = content.items.find((item) => "str" in item && item.str === "付箋");
        assert.ok(stickyText && "transform" in stickyText);
        assert.ok(Math.abs(Math.hypot(stickyText.transform[0], stickyText.transform[1]) - 24) < 0.001);
      }
    } finally { await result.loadingTask.destroy(); }
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), original);
  } finally { await displayed.loadingTask.destroy(); }
});
