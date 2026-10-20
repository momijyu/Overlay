import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryControls } from "@/features/pdf-editor/components/HistoryControls";

test("履歴の有無と処理中状態に応じてUndo・Redoボタンを無効化する", () => {
  for (const canUndo of [false, true]) for (const canRedo of [false, true]) for (const disabled of [false, true]) {
    const markup = renderToStaticMarkup(HistoryControls({ canUndo, canRedo, disabled, onUndo: () => {}, onRedo: () => {} }));
    const buttons = markup.match(/<button\b[\s\S]*?<\/button>/g)!;
    assert.match(markup, /aria-label="編集履歴"/);
    assert.equal(buttons[0].includes('disabled=""'), disabled || !canUndo);
    assert.equal(buttons[1].includes('disabled=""'), disabled || !canRedo);
    assert.ok(buttons[0].includes("元に戻す"));
    assert.ok(buttons[1].includes("やり直す"));
    assert.match(buttons[0], /aria-label="元に戻す" title="元に戻す"/);
    assert.match(buttons[1], /aria-label="やり直す" title="やり直す"/);
    for (const button of buttons) {
      assert.match(button, /<svg[^>]*aria-hidden="true"/);
      assert.equal(button.replace(/<[^>]+>/g, ""), "");
    }
  }
});

test("有効な履歴ボタンだけが対応する操作を呼ぶ", () => {
  let undos = 0;
  let redos = 0;
  for (const canUndo of [false, true]) for (const canRedo of [false, true]) for (const disabled of [false, true]) {
    const element = HistoryControls({ canUndo, canRedo, disabled, onUndo: () => { undos++; }, onRedo: () => { redos++; } });
    const before = [undos, redos];
    element.props.children[0].props.onClick();
    element.props.children[1].props.onClick();
    assert.equal(undos - before[0], !disabled && canUndo ? 1 : 0);
    assert.equal(redos - before[1], !disabled && canRedo ? 1 : 0);
  }
});
