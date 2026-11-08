import assert from "node:assert/strict";
import test, { mock } from "node:test";
import * as React from "react";

const effects: (() => void | (() => void))[] = [];
let stateCursor = 0;
let stateOverrides = new Map<number, unknown>();
mock.module("react", { exports: { ...React,
  useState: (initial: unknown) => {
    const index = stateCursor++;
    return [stateOverrides.has(index) ? stateOverrides.get(index) : initial, (value: unknown) => { stateOverrides.set(index, value); }];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => void | (() => void)) => effects.push(effect),
} });
let reads = 0, fullReads = 0, ticks = 0, disposed = 0, unsubscribed = 0;
let queueChanged = () => {};
mock.module("@/features/pdf-editor/driveLibraryCache", { exports: { readDriveCacheSummary: async () => ({ limitMB: 250, bytes: 0 }) } });
mock.module("@/features/pdf-editor/driveCacheSettings", { exports: {
  DEFAULT_DRIVE_CACHE_MB: 250, MIN_DRIVE_CACHE_MB: 100, MAX_DRIVE_CACHE_MB: 1000, saveDriveCacheLimit: async () => {},
} });
mock.module("@/features/pdf-editor/driveLibraryRuntime", { exports: {
  createBrowserDriveLibrary: () => ({ tick: async () => { ticks++; return true; }, dispose: () => { disposed++; } }),
} });
mock.module("@/features/pdf-editor/driveLibraryLocal", { exports: {
  readLibraryPending: async () => { reads++; return { scope: null, pending: false }; },
  readLibraryStatus: async () => { fullReads++; return { entities: [] }; },
  resolveLibraryPlacement: async () => {},
} });
mock.module("@/features/pdf-editor/driveOutbox", { exports: {
  listDriveBindings: async () => [], updateDriveBinding: async () => {},
} });
mock.module("@/features/pdf-editor/driveQueueEvents", { exports: {
  subscribeDriveQueue: (listener: () => void) => { queueChanged = listener; return () => { unsubscribed++; }; },
} });
mock.module("@/features/pdf-editor/googleDriveSession", { exports: {
  getGoogleDriveSession: () => ({ getConnection: () => null, subscribe: () => () => { unsubscribed++; } }),
} });
const { DriveAutosavePanel } = await import("@/features/pdf-editor/components/DriveAutosavePanel");
const { DriveCacheSettings } = await import("@/features/pdf-editor/components/DriveCacheSettings");

function entries(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...entries(child.props.children as React.ReactNode)] : []);
}

test("送信判定を毎秒継続し、UIのDB確認は変更通知と5秒間隔だけにする", async () => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {} } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  mock.timers.enable({ apis: ["setInterval"] });
  DriveAutosavePanel({ disabled: false, drawerOpen: false });
  const cleanups = effects.map((effect) => effect());
  const settle = () => new Promise(setImmediate);
  try {
    await settle(); assert.equal(reads, 1); assert.equal(ticks, 1);
    for (let i = 0; i < 4; i++) { mock.timers.tick(1000); await settle(); }
    assert.equal(ticks, 5); assert.equal(reads, 1); assert.equal(fullReads, 0);
    queueChanged(); await settle(); assert.equal(reads, 2); assert.equal(ticks, 6);
    mock.timers.tick(1000); await settle(); assert.equal(reads, 3); assert.equal(ticks, 7);
  } finally { cleanups.forEach((cleanup) => cleanup?.()); mock.timers.reset(); }
  assert.equal(disposed, 1); assert.equal(unsubscribed, 2);
});

test("接続設定と状態を同じ欄へまとめ、失敗表示を折りたたみの外に残す", () => {
  const account = { id: "account" }, root = { id: "root" };
  const cases = [
    { connection: null, scope: null, expected: "未接続" },
    { connection: null, scope: { accountId: "account", rootId: "root" }, expected: "再接続が必要です。" },
    { connection: { account, root: null }, scope: null, expected: "保存先を設定してください。" },
    { connection: { account, root }, scope: { accountId: "account", rootId: "root" }, expected: "接続中・自動保存" },
    { connection: { account, root }, scope: { accountId: "other", rootId: "root" }, expected: "接続先を確認してください。" },
  ];
  for (const item of cases) {
    stateCursor = 0;
    stateOverrides = new Map<number, unknown>([[1, item.connection], [2, true], [3, "通信失敗"], [6, item.scope]]);
    const node = DriveAutosavePanel({ disabled: false, drawerOpen: true, children: React.createElement("button", null, "接続設定") });
    const section = entries(node).find((entry) => entry.type === "section")!;
    const all = entries(section);
    assert.ok(all.some((entry) => entry.type === "button" && entry.props.children === "接続設定"));
    assert.equal(all.find((entry) => "data-drive-connection-status" in entry.props)!.props.children, item.expected);
    const details = all.find((entry) => entry.type === "details")!;
    assert.equal(entries(details).find((entry) => entry.props.role === "alert"), undefined);
    assert.ok(all.some((entry) => entry.props.role === "alert" && entry.props.children === "通信失敗"));
    assert.equal(all.find((entry) => entry.type === DriveCacheSettings)!.props.visible, false);
    (details.props.onToggle as (event: unknown) => void)({ currentTarget: { open: true } });
    stateCursor = 0;
    const expanded = DriveAutosavePanel({ disabled: false, drawerOpen: true });
    assert.equal(entries(expanded).find((entry) => entry.type === DriveCacheSettings)!.props.visible, true);
    stateCursor = 0;
    const closedDrawer = DriveAutosavePanel({ disabled: false, drawerOpen: false });
    assert.equal(entries(closedDrawer).find((entry) => entry.type === DriveCacheSettings)!.props.visible, false);
  }
});
