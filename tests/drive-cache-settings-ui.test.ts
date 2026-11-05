import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let states: unknown[] = [], index = 0, first = true;
let effects: (() => void | (() => void))[] = [];
let saved: number[] = []; let failed = false;
mock.module("react", { exports: { ...React,
  useState(initial: unknown) {
    const slot = index++; if (!(slot in states)) states[slot] = initial;
    return [states[slot], (value: unknown) => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }];
  },
  useEffect(effect: () => void | (() => void)) { if (first) effects.push(effect); },
} });
mock.module("@/features/pdf-editor/driveLibraryCache", { exports: {
  readDriveCacheSummary: async () => ({ limitMB: 400, bytes: 3_450_000 }),
} });
mock.module("@/features/pdf-editor/driveCacheSettings", { exports: {
  DEFAULT_DRIVE_CACHE_MB: 250, MIN_DRIVE_CACHE_MB: 100, MAX_DRIVE_CACHE_MB: 1000,
  saveDriveCacheLimit: async (value: number) => { if (failed) throw new Error("保存失敗"); saved.push(value); },
} });
const { DriveCacheSettings } = await import("@/features/pdf-editor/components/DriveCacheSettings");
beforeEach(() => { states = []; effects = []; index = 0; first = true; saved = []; failed = false; });
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as React.ReactNode)] : []);
}
function render() { index = 0; const node = DriveCacheSettings(); first = false; return { entries: elements(node), html: renderToStaticMarkup(node) }; }
const settle = () => new Promise(setImmediate);
async function mount() { render(); const cleanups = effects.map((effect) => effect()); await settle(); return () => cleanups.forEach((fn) => fn?.()); }
function change(type: string, value: string) {
  const input = render().entries.find((entry) => entry.type === "input" && entry.props.type === type)!;
  (input.props.onChange as (event: unknown) => void)({ target: { value } });
}
async function submit() {
  (render().entries.find((entry) => entry.type === "form")!.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
  await settle();
}

test("保存した上限・概算使用量を表示し、スライダーと数値入力を共有して適用する", async () => {
  const close = await mount();
  try {
    assert.match(render().html, /約3.5MB ／ 上限400MB/);
    change("range", "300");
    assert.ok(render().entries.filter((entry) => entry.type === "input").every((entry) => Number(entry.props.value) === 300));
    assert.deepEqual(saved, []); await submit(); assert.deepEqual(saved, [300]);
    assert.match(render().html, /設定しました/); assert.match(render().html, /上限300MB/);
    assert.match(render().html, /未送信・使用中のデータは上限を超えても保持/);
  } finally { close(); }
});

test("不正入力は適用できず、書込失敗では設定値を変更しない", async () => {
  const close = await mount();
  try {
    for (const value of ["", "99", "1001", "250.5"]) {
      change("number", value); await submit(); assert.deepEqual(saved, []);
      assert.equal(render().entries.find((entry) => entry.type === "button")!.props.disabled, true);
    }
    change("number", "250"); failed = true; await submit();
    assert.match(render().html, /保存失敗/); assert.match(render().html, /上限400MB/); assert.deepEqual(saved, []);
  } finally { close(); }
});
