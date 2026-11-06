import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let states: unknown[] = [], index = 0, effectIndex = 0;
let effects: (() => void | (() => void))[] = [];
let effectDeps: unknown[][] = [];
let cleanups: (void | (() => void))[] = [];
let reads = 0;
const listeners = new Set<() => void>();
let saved: number[] = []; let failed = false;
mock.module("react", { exports: { ...React,
  useState(initial: unknown) {
    const slot = index++; if (!(slot in states)) states[slot] = initial;
    return [states[slot], (value: unknown) => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }];
  },
  useEffect(effect: () => void | (() => void), deps: unknown[]) {
    const slot = effectIndex++;
    if (effectDeps[slot] && deps.every((value, i) => Object.is(value, effectDeps[slot][i]))) return;
    effectDeps[slot] = deps;
    effects.push(() => { cleanups[slot]?.(); cleanups[slot] = effect(); });
  },
} });
mock.module("@/features/pdf-editor/driveLibraryCache", { exports: {
  readDriveCacheSummary: async () => { reads++; return { limitMB: 400, bytes: 3_450_000 }; },
} });
mock.module("@/features/pdf-editor/driveQueueEvents", { exports: {
  subscribeDriveQueue: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
} });
mock.module("@/features/pdf-editor/driveCacheSettings", { exports: {
  DEFAULT_DRIVE_CACHE_MB: 250, MIN_DRIVE_CACHE_MB: 100, MAX_DRIVE_CACHE_MB: 1000,
  saveDriveCacheLimit: async (value: number) => { if (failed) throw new Error("保存失敗"); saved.push(value); },
} });
const { DriveCacheSettings } = await import("@/features/pdf-editor/components/DriveCacheSettings");
beforeEach(() => {
  states = []; effects = []; effectDeps = []; cleanups = []; index = effectIndex = reads = 0;
  listeners.clear(); saved = []; failed = false;
});
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as React.ReactNode)] : []);
}
function render(visible = true) {
  index = effectIndex = 0;
  const node = DriveCacheSettings({ visible });
  return { entries: elements(node), html: renderToStaticMarkup(node) };
}
const settle = () => new Promise(setImmediate);
function flushEffects() { effects.splice(0).forEach((effect) => effect()); }
async function mount() { render(); flushEffects(); await settle(); return () => cleanups.forEach((fn) => fn?.()); }
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

test("一覧を閉じると容量走査と通知監視を止め、再表示で最新容量を読み直し入力途中の値を保つ", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    render(false); flushEffects(); await settle();
    assert.equal(reads, 0, "初期状態で非表示ならDBを走査しない");
    render(); flushEffects(); await settle();
    render(); flushEffects(); await settle();
    const details = render().entries.find((entry) => entry.type === "details")!;
    (details.props.onToggle as (event: unknown) => void)({ currentTarget: { open: true } });
    render(); flushEffects(); await settle();
    change("number", "375");
    const before = reads;
    mock.timers.tick(5000); await settle();
    assert.equal(reads, before + 1);
    assert.equal(listeners.size, 1);

    render(false); flushEffects(); await settle();
    const hiddenReads = reads;
    mock.timers.tick(30_000); await settle();
    listeners.forEach((listener) => listener()); await settle();
    assert.equal(reads, hiddenReads, "閉じたままでは容量の定期走査がない");
    assert.equal(listeners.size, 0);

    render(); flushEffects(); await settle();
    assert.equal(reads, hiddenReads + 1, "再表示時に最新の容量を取得");
    assert.equal(render().entries.find((entry) => entry.type === "input" && entry.props.type === "number")!.props.value, "375");
    assert.equal(listeners.size, 1);
  } finally { cleanups.forEach((cleanup) => cleanup?.()); mock.timers.reset(); }
});
