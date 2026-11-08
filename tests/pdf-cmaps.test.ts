import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

// 外部CMapが必要な非埋め込み日本語フォント。配布PDFを持ち込まず、短い自作資料で再現する。
async function japanesePdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 200]); const context = document.context;
  const descendant = context.register(context.obj({ Type: "Font", Subtype: "CIDFontType0", BaseFont: "HeiseiMin-W3",
    CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Japan1"), Supplement: 0 }, DW: 1000 }));
  const font = context.register(context.obj({ Type: "Font", Subtype: "Type0", BaseFont: "HeiseiMin-W3",
    Encoding: "UniJIS-UCS2-H", DescendantFonts: [descendant] }));
  page.node.set(PDFName.of("Resources"), context.obj({ Font: { F1: font } }));
  page.node.set(PDFName.of("Contents"), context.register(context.flateStream("BT /F1 24 Tf 40 100 Td <65E5672C8A9E> Tj ET")));
  return document.save();
}
const assets = new URL("../public/pdfjs/", import.meta.url);

test("CMap未指定で抜ける日本語が、同梱CMapで読み込み・描画命令へ復元される", async () => {
  const data = await japanesePdf();
  for (const withCMaps of [false, true]) {
    const task = getDocument({ data: data.slice(), useSystemFonts: true, verbosity: 0,
      standardFontDataUrl: fileURLToPath(new URL("standard_fonts/", assets)),
      ...(withCMaps ? { cMapUrl: fileURLToPath(new URL("cmaps/", assets)), cMapPacked: true } : {}) });
    try {
      const document = await task.promise; const page = await document.getPage(1);
      const text = (await page.getTextContent()).items.map((item) => "str" in item ? item.str : "").join("");
      assert.equal(text, withCMaps ? "日本語" : "");
      if (withCMaps) {
        const operations = await page.getOperatorList();
        const glyphs = operations.fnArray.flatMap((operation, index) => operation === OPS.showText ? operations.argsArray[index][0] : []);
        assert.equal(glyphs.map((glyph: { unicode?: string }) => glyph.unicode ?? "").join(""), "日本語");
      }
    } finally { await task.destroy(); }
  }
});

test("配信するCMap一式とライセンスはインストール済みPDF.jsと同じ内容を保持する", async () => {
  const original = new URL("../node_modules/pdfjs-dist/cmaps/", import.meta.url);
  const bundled = new URL("cmaps/", assets);
  const names = (await readdir(original)).sort();
  assert.deepEqual((await readdir(bundled)).sort(), names);
  assert.ok(names.includes("LICENSE"));
  for (const name of names) assert.deepEqual(await readFile(new URL(name, bundled)), await readFile(new URL(name, original)), name);
});
