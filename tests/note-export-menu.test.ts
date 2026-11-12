import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let focusCount = 0;
const inside = {};
const details = { open: true, contains: (target: unknown) => target === inside,
  querySelector: () => ({ focus() { focusCount++; } }) };
let effect: (() => void | (() => void)) | undefined;
const events = new EventTarget();
beforeEach(() => { focusCount = 0; effect = undefined; details.open = true; });

mock.module("react", { exports: { ...React, useRef: () => ({ current: details }), useEffect: (next: typeof effect) => { effect = next; } } });
const { NoteExportMenu } = await import("@/features/pdf-editor/components/NoteExportMenu");

function buttons(node: React.ReactNode): React.ReactElement<React.ComponentProps<"button">>[] {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return [];
    return child.type === "button" ? [child as React.ReactElement<React.ComponentProps<"button">>] : buttons(child.props.children);
  });
}

test("PDFと再編集用の違い・定期保管案内をPCとタッチの両方で表示する", () => {
  for (const iconOnly of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(NoteExportMenu, { disabled: false, iconOnly, onDownload: () => {}, onSelectPages: () => {}, onBackup: () => {} }));
    assert.match(html, /aria-label="書き出しメニュー"/);
    assert.match(html, /PDFをダウンロード/);
    assert.match(html, /閲覧・共有用/);
    assert.match(html, /ページを指定してPDF出力/);
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
      onSelectPages: () => { assert.equal(details.open, false); calls.push("pages"); },
      onBackup: () => { assert.equal(details.open, false); calls.push("backup"); },
    }));
    assert.equal(actions.length, 3);
    for (const action of actions) {
      details.open = true;
      assert.equal(action.props.disabled, disabled);
      action.props.onClick!({} as React.MouseEvent<HTMLButtonElement>);
      if (disabled) assert.equal(details.open, true);
    }
    assert.deepEqual(calls, disabled ? [] : ["pdf", "pages", "backup"]);
  }
});


test("外側のクリック・フォーカス移動とEscapeで閉じ、内部操作や出力を勝手に実行しない", () => {
  let calls = 0;
  const tree = NoteExportMenu({ disabled: false, onDownload() { calls++; }, onSelectPages() { calls++; }, onBackup() { calls++; } });
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: events });
  const cleanup = effect!();
  try {
    for (const type of ["pointerdown", "focusin"]) {
      details.open = true;
      const internal = new Event(type); Object.defineProperty(internal, "target", { value: inside });
      events.dispatchEvent(internal); assert.equal(details.open, true);
      events.dispatchEvent(new Event(type)); assert.equal(details.open, false);
    }
    details.open = true;
    const props = tree.props as React.ComponentProps<"details">;
    let prevented = 0, stopped = 0;
    props.onKeyDown!({ key: "Escape", preventDefault() { prevented++; }, stopPropagation() { stopped++; } } as unknown as React.KeyboardEvent<HTMLDetailsElement>);
    assert.equal(details.open, false); assert.equal(focusCount, 1);
    assert.equal(prevented, 1); assert.equal(stopped, 1); assert.equal(calls, 0);
    cleanup?.(); details.open = true;
    events.dispatchEvent(new Event("pointerdown")); assert.equal(details.open, true);
  } finally {
    cleanup?.();
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});
