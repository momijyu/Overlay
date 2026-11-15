import assert from "node:assert/strict";
import test, { mock } from "node:test";
import * as React from "react";

let open = false;
mock.module("react", { exports: { ...React,
  useState: () => [open, (value: boolean) => { open = value; }],
} });

const { UsageGuideButton } = await import("@/app/about/UsageGuideButton");
const { EditorHelpDialog } = await import("@/features/pdf-editor/components/EditorHelpDialog");

test("紹介ページでは操作後だけ既存の使い方を開き、終了後に閉じて再び開ける", () => {
  function entries() { return React.Children.toArray(UsageGuideButton().props.children).filter(React.isValidElement); }
  function guide() { return entries().find((entry) => entry.type === EditorHelpDialog); }
  function activate() {
    const button = entries().find((entry) => entry.type === "button") as React.ReactElement<React.ComponentProps<"button">>;
    assert.equal(button.props["aria-haspopup"], "dialog");
    button.props.onClick!({} as React.MouseEvent<HTMLButtonElement>);
  }
  assert.equal(guide(), undefined);
  activate();
  const dialog = guide() as React.ReactElement<{ onClose: () => void }>;
  assert.ok(dialog);
  dialog.props.onClose();
  assert.equal(guide(), undefined);
  activate();
  assert.ok(guide());
});
