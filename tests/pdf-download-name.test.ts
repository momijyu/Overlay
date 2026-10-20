import assert from "node:assert/strict";
import test from "node:test";
import { pdfDownloadName } from "@/features/pdf-editor/pdfDownloadName";

test("ダウンロード名はノート名を使い、日本語・空白を維持する", () => {
  assert.equal(pdfDownloadName("情報 第4回"), "情報 第4回.pdf");
  assert.equal(pdfDownloadName("  授業メモ  "), "授業メモ.pdf");
  assert.equal(pdfDownloadName(".txt.png"), ".txt.png.pdf");
});

test("PDFの拡張子は重複させず、小文字の.pdfへ統一する", () => {
  assert.equal(pdfDownloadName("授業.pdf"), "授業.pdf");
  assert.equal(pdfDownloadName("授業.PDF"), "授業.pdf");
});

test("区切りや制御文字をダウンロード名だけで置き換える", () => {
  assert.equal(pdfDownloadName('授業/参考\\資料:*?"<>|'), "授業_参考_資料_______.pdf");
  assert.equal(pdfDownloadName("授業\nメモ"), "授業_メモ.pdf");
  assert.equal(pdfDownloadName("../授業..."), ".._授業.pdf");
});

test("空名や拡張子だけの場合も有効なPDF名にする", () => {
  for (const name of ["", "   ", ".", "..", ".pdf", ".PDF"]) assert.equal(pdfDownloadName(name), "ノート.pdf");
});
