import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";

const effects: (() => void | (() => void))[] = [];
let stateCursor = 0;
let stateOverrides = new Map<number, unknown>();
mock.module("react", { exports: { ...React,
  useState: (initial: unknown) => {
    const index = stateCursor++;
    const current = stateOverrides.has(index) ? stateOverrides.get(index) : initial;
    return [current, (value: unknown) => { stateOverrides.set(index, typeof value === "function" ? value(stateOverrides.has(index) ? stateOverrides.get(index) : initial) : value); }];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => void | (() => void)) => effects.push(effect),
} });
let reads = 0, fullReads = 0, ticks = 0, disposed = 0, unsubscribed = 0;
let queueChanged = () => {};
let sessionChanged = () => {};
let connection: { account: { id: string }; root: { id: string } } | null = null;
let readPending = async (): Promise<{ scope: null; pending: boolean }> => ({ scope: null, pending: false });
mock.module("@/features/pdf-editor/driveLibraryCache", { exports: { readDriveCacheSummary: async () => ({ limitMB: 250, bytes: 0 }) } });
mock.module("@/features/pdf-editor/driveCacheSettings", { exports: {
  DEFAULT_DRIVE_CACHE_MB: 250, MIN_DRIVE_CACHE_MB: 100, MAX_DRIVE_CACHE_MB: 1000, saveDriveCacheLimit: async () => {},
} });
mock.module("@/features/pdf-editor/driveLibraryRuntime", { exports: {
  createBrowserDriveLibrary: () => ({ tick: async () => { ticks++; return true; }, dispose: () => { disposed++; } }),
} });
mock.module("@/features/pdf-editor/driveLibraryLocal", { exports: {
  readLibraryPending: async () => { reads++; return readPending(); },
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
  getGoogleDriveSession: () => ({ getConnection: () => connection, subscribe: (listener: () => void) => {
    sessionChanged = listener; return () => { unsubscribed++; };
  } }),
} });
const { DriveAutosavePanel } = await import("@/features/pdf-editor/components/DriveAutosavePanel");
const { DriveCacheSettings } = await import("@/features/pdf-editor/components/DriveCacheSettings");

beforeEach(() => {
  effects.length = 0; stateCursor = 0; stateOverrides.clear();
  reads = 0; fullReads = 0; ticks = 0; disposed = 0; unsubscribed = 0;
  connection = null; queueChanged = () => {}; sessionChanged = () => {};
  readPending = async () => ({ scope: null, pending: false });
});

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
    { connection: null, scope: null, expected: "未接続・ブラウザに保存" },
    { connection: null, scope: null, rows: [{ enabled: true }], expected: "再接続が必要です。" },
    { connection: null, scope: { accountId: "account", rootId: "root" }, expected: "再接続が必要です。" },
    { connection: { account, root: null }, scope: null, expected: "保存先を設定してください。" },
    { connection: { account, root }, scope: { accountId: "account", rootId: "root" }, expected: "接続中・自動保存" },
    { connection: { account, root }, scope: { accountId: "other", rootId: "root" }, expected: "接続先を確認してください。" },
  ];
  for (const item of cases) {
    stateCursor = 0;
    stateOverrides = new Map<number, unknown>([[0, item.rows ?? []], [1, item.connection], [2, true], [3, "通信失敗"], [6, item.scope]]);
    const node = DriveAutosavePanel({ disabled: false, drawerOpen: true, children: React.createElement("button", null, "接続設定") });
    const section = entries(node).find((entry) => entry.type === "section")!;
    const all = entries(section);
    assert.ok(all.some((entry) => entry.type === "button" && entry.props.children === "接続設定"));
    assert.equal(all.find((entry) => "data-drive-connection-status" in entry.props)!.props.children, item.expected);
    assert.equal(all.find((entry) => entry.type === "details"), undefined, "容量設定を保存の詳細に入れ子にしない");
    assert.ok(all.some((entry) => entry.props.role === "alert" && entry.props.children === "通信失敗"));
    assert.equal(all.find((entry) => entry.type === DriveCacheSettings)!.props.visible, true);
    stateCursor = 0;
    const closedDrawer = DriveAutosavePanel({ disabled: false, drawerOpen: false });
    assert.equal(entries(closedDrawer).find((entry) => entry.type === DriveCacheSettings)!.props.visible, false);
  }
});

test("DB確認中の失効・再接続を即時表示し、重なった変更通知は定期確認を待たず再取得する", async () => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {} } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  let release!: (value: { scope: null; pending: boolean }) => void;
  const waiting = new Promise<{ scope: null; pending: boolean }>((resolve) => { release = resolve; });
  readPending = async () => reads === 1 ? waiting : { scope: null, pending: false };
  connection = { account: { id: "account" }, root: { id: "root" } };
  mock.timers.enable({ apis: ["setInterval"] });
  DriveAutosavePanel({ disabled: false, drawerOpen: false });
  const cleanups = effects.map((effect) => effect());
  const settle = () => new Promise(setImmediate);
  try {
    await settle(); assert.equal(reads, 1);
    connection = null; sessionChanged();
    assert.equal(stateOverrides.get(1), null);
    connection = { account: { id: "reconnected" }, root: { id: "new-root" } }; sessionChanged();
    assert.deepEqual(stateOverrides.get(1), connection);
    queueChanged(); queueChanged();
    assert.equal(reads, 1);
    release({ scope: null, pending: true });
    await settle(); await settle();
    assert.equal(reads, 2); // 通知ごとに増やさず、送信完了後の最新状態まで追従。
    assert.deepEqual(stateOverrides.get(1), connection);
    assert.equal(stateOverrides.get(7), false);
  } finally { cleanups.forEach((cleanup) => cleanup?.()); mock.timers.reset(); }
});

test("DB確認中に画面を破棄した場合は保留した再取得と表示更新を実行しない", async () => {
  let release!: (value: { scope: null; pending: boolean }) => void;
  readPending = () => new Promise((resolve) => { release = resolve; });
  mock.timers.enable({ apis: ["setInterval"] });
  DriveAutosavePanel({ disabled: false, drawerOpen: false });
  const cleanups = effects.map((effect) => effect());
  try {
    await new Promise(setImmediate);
    queueChanged();
    cleanups.forEach((cleanup) => cleanup?.());
    stateOverrides.clear();
    release({ scope: null, pending: true });
    await new Promise(setImmediate);
    assert.equal(reads, 1); assert.equal(stateOverrides.size, 0);
  } finally { mock.timers.reset(); }
});
