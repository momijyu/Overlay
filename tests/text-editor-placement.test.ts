import assert from "node:assert/strict";
import test from "node:test";
import { textEditorOptionsPosition } from "@/features/pdf-editor/textEditorPlacement";

test("右端・上端・下端・画面外の文章でも設定を可視領域に収め、PDFの倍率を補正する", () => {
  const bounds = { left: 100, right: 700, top: 200, bottom: 600 };
  for (const scale of [.5, 1, 2, 3]) {
    for (const left of [0, 110, 680, 800]) for (const top of [100, 210, 560, 800]) {
      const anchor = { left, right: left + 30, top, bottom: top + 30 };
      const pos = textEditorOptionsPosition(anchor, 288, 160, bounds, scale);
      const x = anchor.left + pos.left * scale, y = anchor.top + pos.top * scale;
      assert.ok(x >= 108 && x + 288 <= 692);
      assert.ok(y >= 208 && y + 160 <= 592);
    }
  }
});

test("PDF表示枠が設定欄より小さい時は幅と高さを制限し、上に余裕がなければ下へ出す", () => {
  const pos = textEditorOptionsPosition({ left: 0, right: 20, top: 10, bottom: 40 }, 288, 160,
    { left: 0, right: 200, top: 0, bottom: 100 }, 1);
  assert.deepEqual(pos, { left: 8, top: -2, maxWidth: 184, maxHeight: 84 });
  assert.equal(textEditorOptionsPosition({ left: 20, right: 40, top: 10, bottom: 40 }, 288, 160,
    { left: 0, right: 600, top: 0, bottom: 600 }, 1).top, 38);
});
