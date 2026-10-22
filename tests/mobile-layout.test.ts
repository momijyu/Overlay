import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("スマホ専用の配置は640px未満に限定し、PDFを残りの高さへ広げる", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const mobile = css.slice(css.indexOf("@media (width < 640px)"), css.indexOf("/* ノート一覧だけに適用"));
  assert.match(mobile, /\.overlay-app\[data-pdf-open="true"\][^{]*\{[^}]*height: 100dvh/);
  assert.match(mobile, /\.pdf-viewport\s*\{[^}]*flex: 1;[^}]*min-height: 0;[^}]*max-height: none/);
  assert.match(mobile, /\.editor-settings\s*\{ display: none/);
  assert.match(mobile, /\.editor-settings\[data-mobile-open="true"\]/);
  assert.match(mobile, /\.editor-tools > \.zoom-control \{ display: none/);
  assert.match(mobile, /\.text-editor-panel textarea[^}]*font-size: 16px !important/);
  assert.match(mobile, /--editor-keyboard-offset/);
  assert.match(mobile, /\.text-editor-options[^}]*position: static/);
  // CSSの設定を検証するテスト。実画面のサイズやソフトキーボードは実機確認する。
});
