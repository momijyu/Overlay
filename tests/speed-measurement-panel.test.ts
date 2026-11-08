import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { speedMeasurements } from "@/features/pdf-editor/speedMeasurements";

let states: unknown[], cursor: number;
mock.module("react", { exports: { ...React, useState(initial: unknown) {
  const index = cursor++;
  if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
  return [states[index], (value: unknown) => { states[index] = value; }];
} } });
const { SpeedMeasurementPanel } = await import("@/features/pdf-editor/components/SpeedMeasurementPanel");
beforeEach(() => { states = []; cursor = 0; speedMeasurements.clear(); });
afterEach(() => { speedMeasurements.clear(); mock.restoreAll(); mock.timers.reset(); });
function render() { cursor = 0; return SpeedMeasurementPanel(); }
function entries(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...entries(child.props.children as React.ReactNode)] : []);
}
function button(label: string) { return entries(render()).find((child) => child.type === "button" && child.props.children === label)!; }
function click(label: string) { const value = button(label); assert.equal(value.props.disabled, false); (value.props.onClick as () => void)(); }

test("折りたたみ内の明示操作だけで開始・停止・消去し、再表示で計測状態を維持", () => {
  assert.equal(render().type, "details"); assert.equal(speedMeasurements.snapshot().recording, false);
  assert.equal(button("結果を保存").props.disabled, true);
  click("計測を開始"); assert.equal(button("計測を開始").props.disabled, true);
  assert.equal(button("結果を消去").props.disabled, true);
  speedMeasurements.begin("note.read").finish();
  states = []; // ダイアログを閉じて再表示。
  assert.match(renderToStaticMarkup(render()), /計測中/);
  click("計測を停止"); assert.match(renderToStaticMarkup(render()), /1件の計測結果/);
  click("結果を消去"); assert.equal(button("結果を保存").props.disabled, true);
});

test("結果JSONを書き出し、認証情報・生のUA・URLを含めず、Object URLを解放", async () => {
  let saved: Blob | undefined, clicks = 0, removed = 0, revoked = 0;
  const link = { href: "", download: "", click: () => { clicks++; }, remove: () => { removed++; } };
  mock.method(URL, "createObjectURL", (blob: Blob) => { saved = blob; return "blob:test"; });
  mock.method(URL, "revokeObjectURL", () => { revoked++; });
  mock.timers.enable({ apis: ["setTimeout"] });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { innerWidth: 800, innerHeight: 600, devicePixelRatio: 2, setTimeout } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => link, body: { appendChild() {} } } });
  try {
    click("計測を開始"); speedMeasurements.begin("note.open").finish(); click("計測を停止"); click("結果を保存");
    const report = JSON.parse(await saved!.text());
    assert.equal(report.formatVersion, 1); assert.equal(report.records.length, 1);
    assert.equal(report.environment.width, 800); assert.ok(["Other", "Chrome", "Firefox", "Safari", "Edge"].includes(report.environment.browser));
    assert.doesNotMatch(await saved!.text(), /userAgent|localhost|accounts.google|access_token/);
    assert.equal(link.download, "overlay-speed.json"); assert.equal(clicks, 1); assert.equal(removed, 1);
    mock.timers.tick(1000); assert.equal(revoked, 1);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument); else Reflect.deleteProperty(globalThis, "document");
  }
});
