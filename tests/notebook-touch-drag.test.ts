import assert from "node:assert/strict";
import test from "node:test";
import { attachNotebookTouchDrag, createNotebookTouchDrag, NOTE_LONG_PRESS_MS, notebookDropAt } from "@/features/pdf-editor/notebookTouchDrag";
import { canMoveItems, selectedMoveRoots } from "@/features/pdf-editor/noteDrag";
import type { NoteLibrary } from "@/features/pdf-editor/types";

const item = { kind: "note" as const, id: "note" };
const point = { x: 10, y: 10 };

test("400msの長押し後だけ移動を開始し、指を離した位置で1回確定する", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  assert.equal(NOTE_LONG_PRESS_MS, 400);
  const calls: unknown[] = [];
  const drag = createNotebookTouchDrag({ onStart: (...args) => calls.push(["start", ...args]),
    onMove: (p) => calls.push(["move", p]), onDrop: (p) => calls.push(["drop", p]), onCancel: () => calls.push("cancel") });
  drag.start(1, point, item, 1);
  t.mock.timers.tick(NOTE_LONG_PRESS_MS - 1);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, [["start", item, point]]);
  assert.equal(drag.move(1, { x: 30, y: 60 }, 1), true);
  assert.equal(drag.end(1, { x: 30, y: 70 }), true);
  assert.equal(drag.end(1, point), false);
  assert.deepEqual(calls.slice(1), [["move", { x: 30, y: 60 }], ["drop", { x: 30, y: 70 }]]);
  assert.equal(drag.suppressClick(), true);
  t.mock.timers.tick(801);
  assert.equal(drag.suppressClick(), false);
});

test("短いタップ・長押し前のスクロール・二本指ではドラッグしない", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let starts = 0;
  const drag = createNotebookTouchDrag({ onStart: () => starts++, onMove: () => {}, onDrop: () => assert.fail(), onCancel: () => {} });
  drag.start(1, point, item, 1);
  t.mock.timers.tick(NOTE_LONG_PRESS_MS - 1);
  assert.equal(drag.end(1, point), false);
  assert.equal(drag.suppressClick(), false);
  t.mock.timers.tick(1000);
  drag.start(1, point, item, 1);
  assert.equal(drag.move(1, { x: 10, y: 25 }, 1), false);
  t.mock.timers.tick(1000);
  drag.start(1, point, item, 2);
  t.mock.timers.tick(1000);
  assert.equal(starts, 0);
});

test("二本指への切替・中断・破棄では保存せず、長押し後の誤クリックも抑止する", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let cancelled = 0;
  const drag = createNotebookTouchDrag({ onStart: () => {}, onMove: () => {}, onDrop: () => assert.fail(), onCancel: () => cancelled++ });
  drag.start(1, point, item, 1);
  t.mock.timers.tick(NOTE_LONG_PRESS_MS);
  assert.equal(drag.move(1, point, 2), false);
  assert.equal(drag.end(1, point), false);
  assert.equal(cancelled, 1);
  assert.equal(drag.suppressClick(), true);
  drag.start(2, point, item, 1);
  drag.cancel();
  t.mock.timers.tick(NOTE_LONG_PRESS_MS);
  assert.equal(drag.tracking(), false);
});

test("native listenerは長押し後だけスクロールとクリックを抑止し、解除後は全監視を外す", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  class TouchRow extends EventTarget {
    dataset = { notebookItem: JSON.stringify(item) };
    closest(selector: string) { return selector === "[data-notebook-item]" ? this : null; }
  }
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
  const surface = new EventTarget();
  Object.defineProperty(globalThis, "window", { configurable: true, value: surface });
  Object.defineProperty(globalThis, "Element", { configurable: true, value: TouchRow });
  t.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
    if (oldElement) Object.defineProperty(globalThis, "Element", oldElement); else Reflect.deleteProperty(globalThis, "Element");
  });
  const row = new TouchRow();
  let started = 0, dropped = 0, moved = 0;
  const dispose = attachNotebookTouchDrag(row as unknown as HTMLElement, {
    onStart: () => started++, onMove: () => moved++, onDrop: () => dropped++, onCancel: () => {},
  });
  const touch = (type: string, touches = [{ identifier: 1, clientX: 10, clientY: 10 }]) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: [{ identifier: 1, clientX: 40, clientY: 50 }] } });
    (type === "touchstart" ? row : surface).dispatchEvent(event);
    return event;
  };
  touch("touchstart");
  assert.equal(touch("touchmove").defaultPrevented, false);
  t.mock.timers.tick(NOTE_LONG_PRESS_MS);
  assert.equal(started, 1);
  const native = new Event("dragstart", { cancelable: true });
  row.dispatchEvent(native);
  assert.equal(native.defaultPrevented, true);
  assert.equal(touch("touchmove").defaultPrevented, true);
  assert.equal(moved, 1);
  assert.equal(touch("touchend", []).defaultPrevented, true);
  assert.equal(dropped, 1);
  const click = new Event("click", { cancelable: true });
  row.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  dispose();
  touch("touchstart");
  t.mock.timers.tick(NOTE_LONG_PRESS_MS);
  assert.equal(started, 1);
  assert.equal(touch("touchmove").defaultPrevented, false);
});

const library: NoteLibrary = { foldersEnabled: true,
  folders: [{ id: "parent", name: "親", parentId: null }, { id: "child", name: "子", parentId: "parent" },
    { id: "target", name: "先", parentId: null }, { id: "copy", name: "子", parentId: "target" }],
  notes: [{ id: "note", title: "授業", fileName: "test.pdf", folderId: "child", updatedAt: "2026-10-22" }] };

test("一括選択の親子を重複移動せず、循環・同名衝突・全件変更なしを拒否する", () => {
  const items = [{ kind: "folder" as const, id: "parent" }, { kind: "folder" as const, id: "child" }, item, item];
  assert.deepEqual(selectedMoveRoots(items, library), [items[0]]);
  assert.equal(canMoveItems(items, "target", library), true);
  assert.equal(canMoveItems(items, "child", library), false);
  assert.equal(canMoveItems(items, "parent", library), false);
  assert.equal(canMoveItems(items, null, library), false);
  assert.equal(canMoveItems([items[1]], "target", library), false);
  assert.equal(canMoveItems([item], "child", library), false);
  assert.equal(canMoveItems([], "target", library), false);
  assert.equal(canMoveItems([{ kind: "note", id: "missing" }], "target", library), false);
});

test("子要素上も最も近いフォルダを移動先にし、一覧外は受け取らない", () => {
  let target: { dataset: { notebookDrop: string } } | null = { dataset: { notebookDrop: "child" } };
  let inside = true;
  const root = { ownerDocument: { elementFromPoint: () => ({ closest: () => target }) }, contains: () => inside } as unknown as HTMLElement;
  assert.equal(notebookDropAt(root, 1, 2), "child");
  target!.dataset.notebookDrop = "root";
  assert.equal(notebookDropAt(root, 1, 2), null);
  inside = false;
  assert.equal(notebookDropAt(root, 1, 2), undefined);
  target = null;
  assert.equal(notebookDropAt(root, 1, 2), undefined);
});
