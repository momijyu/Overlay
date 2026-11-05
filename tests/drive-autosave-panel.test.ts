import assert from "node:assert/strict";
import test, { mock } from "node:test";
import * as React from "react";

const effects: (() => void | (() => void))[] = [];
mock.module("react", { exports: { ...React,
  useState: (initial: unknown) => [initial, () => {}],
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
