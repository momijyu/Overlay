import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorIcon, type EditorIconName } from "@/features/pdf-editor/components/EditorIcon";

test("道具・Undo・Redo・ページ矢印の9種類を同じ線幅のSVGで描き、絵文字・画像・表示用テキストを使わない", () => {
  const names: EditorIconName[] = ["pen", "marker", "eraser", "text", "sticky", "undo", "redo", "previous-page", "next-page"];
  const drawings = names.map((name) => renderToStaticMarkup(EditorIcon({ name })));
  assert.equal(new Set(drawings).size, 9);
  for (const html of drawings) {
    assert.match(html, /viewBox="0 0 24 24"/);
    assert.match(html, /stroke="currentColor" stroke-width="1.75"/);
    assert.match(html, /aria-hidden="true" focusable="false"/);
    assert.match(html, /<path /);
    assert.doesNotMatch(html, /<img|<image|<text|<script|\p{Extended_Pictographic}/u);
    assert.equal(html.replace(/<[^>]+>/g, ""), "");
  }
});

test("Lucide 1.59.0の9種類の図形を維持し、表示サイズと線幅は従来のままにする", () => {
  // 固定タグの公式SVGから取得したpath。取得元の対応はdocs/icon-sources.mdへ記録。
  const paths: Record<EditorIconName, string[]> = {
    pen: ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4"],
    marker: ["m9 11-6 6v3h9l3-3", "m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"],
    eraser: ["M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21", "m5.082 11.09 8.828 8.828"],
    text: ["M14 21h1", "M14 3h1", "M19 3a2 2 0 0 1 2 2", "M21 14v1", "M21 19a2 2 0 0 1-2 2", "M21 9v1",
      "M3 14v1", "M3 9v1", "M5 21a2 2 0 0 1-2-2", "M5 3a2 2 0 0 0-2 2", "M7 12h10", "M7 16h6", "M7 8h8", "M9 21h1", "M9 3h1"],
    sticky: ["M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z", "M15 3v5a1 1 0 0 0 1 1h5"],
    undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"],
    redo: ["m15 14 5-5-5-5", "M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"],
    "previous-page": ["m15 18-6-6 6-6"],
    "next-page": ["m9 18 6-6-6-6"],
  };
  for (const name of Object.keys(paths) as EditorIconName[]) {
    const markup = renderToStaticMarkup(EditorIcon({ name }));
    assert.deepEqual([...markup.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]), paths[name]);
    assert.match(markup, /class="size-6 shrink-0"/);
    assert.match(markup, /stroke-width="1.75"/);
  }
});

test("配信するLucideライセンス全文が取得元と一致し、出典とバージョンの記録を保持する", () => {
  const license = readFileSync(new URL("../public/licenses/lucide-LICENSE.txt", import.meta.url));
  // 同じタグの公式LICENSEを取得し、SHA-256で完全一致を確認した値。テストでは通信しない。
  assert.equal(createHash("sha256").update(license).digest("hex"), "b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57");
  const sources = readFileSync(new URL("../docs/icon-sources.md", import.meta.url), "utf8");
  assert.match(sources, /1\.59\.0/);
  assert.match(sources, /\/licenses\/lucide-LICENSE\.txt/);
  for (const name of ["pencil", "highlighter", "eraser", "square-dashed-text", "sticky-note", "undo-2", "redo-2", "chevron-left", "chevron-right"]) {
    assert.ok(sources.includes(`1.59.0/icons/${name}.svg`));
  }
});
