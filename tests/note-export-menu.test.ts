import assert from "node:assert/strict";
import test, { mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const details = { open: true };
mock.module("react", { exports: { ...React, useRef: () => ({ current: details }) } });
const { NoteExportMenu } = await import("@/features/pdf-editor/components/NoteExportMenu");

function buttons(node: React.ReactNode): React.ReactElement<React.ComponentProps<"button">>[] {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return [];
    return child.type === "button" ? [child as React.ReactElement<React.ComponentProps<"button">>] : buttons(child.props.children);
  });
}

test("PDFと再編集用の違い・定期保管案内をPCとタッチの両方で表示する", () => {
  for (const iconOnly of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(NoteExportMenu, { disabled: false, iconOnly, onDownload: () => {}, onBackup: () => {} }));
    assert.match(html, /aria-label="書き出しメニュー"/);
    assert.match(html, /PDFをダウンロード/);
    assert.match(html, /閲覧・共有用/);
    assert.match(html, /編集用バックアップ/);
    assert.match(html, /再編集できる形式（.overlay）/);
    assert.match(html, /※ 重要なノートは定期的に/);
    assert.doesNotMatch(html, /Driveに保存|今すぐ保存/);
  }
});

test("メニューを閉じて選んだ出力だけを呼び出し、処理中はどちらも実行しない", () => {
  for (const disabled of [false, true]) {
    const calls: string[] = [];
    const actions = buttons(NoteExportMenu({ disabled,
      onDownload: () => { assert.equal(details.open, false); calls.push("pdf"); },
      onBackup: () => { assert.equal(details.open, false); calls.push("backup"); },
    }));
    assert.equal(actions.length, 2);
    for (const action of actions) {
      details.open = true;
      assert.equal(action.props.disabled, disabled);
      action.props.onClick!({} as React.MouseEvent<HTMLButtonElement>);
      if (disabled) assert.equal(details.open, true);
    }
    assert.deepEqual(calls, disabled ? [] : ["pdf", "backup"]);
  }
});
