import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("狭い画面とタッチ中心の画面は同じ条件でUIを切り替え、PDFを残りの高さへ広げる", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const mobile = css.slice(css.indexOf("@media (width < 640px)"), css.indexOf("/* ノート一覧だけに適用"));
  assert.match(mobile, /^@media \(width < 640px\), \(hover: none\) and \(pointer: coarse\)/);
  assert.match(css, /\.mobile-only \{ display: none/);
  assert.match(mobile, /\.desktop-only \{ display: none/);
  assert.match(mobile, /\.mobile-only \{ display: block/);
  assert.match(mobile, /\.overlay-app\[data-pdf-open="true"\][^{]*\{[^}]*height: 100dvh/);
  assert.match(mobile, /\.overlay-app\[data-pdf-open="true"\][^{]*\{[^}]*overflow: hidden/);
  assert.match(mobile, /\.pdf-viewport\s*\{[^}]*flex: 1;[^}]*min-height: 0;[^}]*max-height: none/);
  assert.match(mobile, /\.editor-settings\s*\{ display: none/);
  assert.match(mobile, /\.editor-settings\[data-mobile-open="true"\]/);
  assert.match(mobile, /\.editor-tools > \.zoom-control \{ display: none/);
  assert.match(mobile, /\.text-editor-panel textarea[^}]*font-size: 16px !important/);
  assert.match(mobile, /--editor-keyboard-offset/);
  assert.match(mobile, /\.text-editor-options[^}]*position: static/);
  assert.match(mobile, /env\(safe-area-inset-left\)/);
  assert.match(mobile, /env\(safe-area-inset-right\)/);
  assert.match(mobile, /overscroll-behavior: contain/);
  // 高さの変化だけで表示モードを切り替えない（キーボード表示でPC用UIへ戻さない）。
  assert.doesNotMatch(mobile.slice(0, mobile.indexOf("{")), /height/);
  // CSSの設定を検証するテスト。実画面のサイズやソフトキーボードは実機確認する。
});

test("横向き相当の幅ではページ操作を同じ行へ置き、設定はPDFを押し下げない", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.editor-settings\[data-mobile-open="true"\]\s*\{[^}]*position: absolute;[^}]*max-height: min\(45dvh, 16rem,/);
  assert.match(css, /@media \(width >= 640px\)\s*\{\s*\.editor-toolbar \{ display: grid/);
  assert.match(css, /\[data-editor-row="actions"\] \{ grid-column: 2; grid-row: 1/);
  assert.match(css, /\.text-editor-panel \{ display: grid; grid-template-columns/);
  assert.match(css, /\.text-editor-actions \{ position: sticky; bottom: 0/);
});

test("設定・書き出し・ノート名の表示は幅だけのsm指定へ依存しない", () => {
  const workspace = readFileSync(new URL("../src/features/pdf-editor/components/PdfWorkspace.tsx", import.meta.url), "utf8");
  const header = readFileSync(new URL("../src/components/layout/AppHeader.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(workspace + header, /sm:(?:hidden|inline|flex|block)/);
  assert.match(workspace, /mobile-only/);
  assert.match(workspace, /desktop-only/);
  assert.match(header, /compact \? "desktop-only"/);
});
