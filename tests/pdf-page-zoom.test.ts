import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

// DOM配置・PDF.js自体は代用し、倍率変更と描画の非同期接続を検証する。
let states: { value: unknown }[];
let refs: { current: unknown }[];
let stateIndex: number;
let refIndex: number;
let effectIndex: number;
type Effect = { deps?: unknown[]; cleanup?: () => void };
let effects: Effect[];
let pendingLayouts: (() => void)[];
let pendingEffects: (() => void)[];
function effect(queue: (() => void)[], callback: () => (() => void) | void, deps: unknown[]) {
  const entry = effects[effectIndex++] ??= {};
  if (entry.deps && deps.every((value, index) => Object.is(value, entry.deps![index]))) return;
  entry.deps = deps;
  queue.push(() => { entry.cleanup?.(); entry.cleanup = callback() || undefined; });
}
mock.module("react", { exports: {
  ...React,
  useState: (initial: unknown) => {
    const index = stateIndex++;
    const slot = states[index] ??= { value: index === 0 ? 400 : initial };
    return [slot.value, (value: unknown) => { slot.value = value; }];
  },
  useRef: (initial: unknown) => refs[refIndex++] ??= { current: initial },
  useEffect: (callback: () => (() => void) | void, deps: unknown[]) => effect(pendingEffects, callback, deps),
  useLayoutEffect: (callback: () => (() => void) | void, deps: unknown[]) => effect(pendingLayouts, callback, deps),
} });
const { PdfPage } = await import("@/features/pdf-editor/components/PdfPage");
const { PenLayer } = await import("@/features/pdf-editor/components/PenLayer");
const { TextLayer } = await import("@/features/pdf-editor/components/TextLayer");

beforeEach(() => {
  states = []; refs = []; effects = []; pendingLayouts = []; pendingEffects = [];
  stateIndex = 0; refIndex = 0; effectIndex = 0;
  Object.assign(globalThis, {
    ResizeObserver: class { observe() {} disconnect() {} },
    window: { devicePixelRatio: 2 },
  });
});

function fixture() {
  const draws: unknown[] = [];
  const canvas = { width: 300, height: 150, style: { width: "", height: "" },
    ownerDocument: { createElement: () => ({ width: 0, height: 0 }) },
    getContext: () => ({ drawImage: (image: unknown) => { draws.push(image); } }),
  };
  const viewport = Object.assign(new EventTarget(), {
    clientWidth: 400, clientHeight: 300, clientLeft: 0, clientTop: 0, scrollLeft: 0, scrollTop: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  });
  const surface = { getBoundingClientRect: () => ({ left: -viewport.scrollLeft, top: -viewport.scrollTop,
    width: parseFloat(canvas.style.width) || 300, height: parseFloat(canvas.style.height) || 150 }) };
  const tasks: { canvas: unknown; scale: number; resolve: () => void; reject: () => void; cancelled: boolean }[] = [];
  const document = { getPage: async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    render: ({ canvas: buffer, viewport: page }: { canvas: unknown; viewport: { scale: number } }) => {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      const task = { canvas: buffer, scale: page.scale, resolve, reject: () => reject(new Error("cancelled")), cancelled: false };
      tasks.push(task);
      return { promise, cancel: () => { task.cancelled = true; } } as unknown as RenderTask;
    },
  }) } as unknown as PDFDocumentProxy;
  let zoom = 1;
  let disabled = false;
  function render() {
    stateIndex = 0; refIndex = 0; effectIndex = 0;
    const element = PdfPage({ document, pageNumber: 1, strokes: [], texts: [], editVersion: 0,
      penWidth: 2.5, penColor: "#000000", tool: "text", eraserWidth: 16,
      zoom, disabled, onZoomChange: changeZoom, onStrokeComplete: () => {}, onStrokesChange: () => {}, onTextsChange: () => {},
    });
    refs[0].current = viewport;
    refs[1].current = canvas;
    refs[2].current = surface;
    pendingLayouts.splice(0).forEach((run) => run());
    pendingEffects.splice(0).forEach((run) => run());
    return element;
  }
  function changeZoom(next: number) { zoom = next; }
  function wheel(ctrlKey: boolean, deltaY = -20) {
    const event = new Event("wheel", { cancelable: true });
    Object.assign(event, { ctrlKey, metaKey: false, deltaY, deltaMode: 0, clientX: 100, clientY: 150 });
    viewport.dispatchEvent(event);
    return event;
  }
  return { render, tasks, canvas, viewport, draws, wheel, setZoom: changeZoom,
    disable: () => { disabled = true; }, zoom: () => zoom,
    cleanup: () => effects.forEach((entry) => entry.cleanup?.()),
  };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); }
function childElement<T>(element: React.ReactElement, type: (props: T) => React.ReactNode): React.ReactElement<T> {
  function walk(node: React.ReactNode): React.ReactElement | undefined {
    for (const child of React.Children.toArray(node)) {
      if (!React.isValidElement<{ children?: React.ReactNode }>(child)) continue;
      if (child.type === type) return child;
      const found = walk(child.props.children);
      if (found) return found;
    }
  }
  return walk(element)! as React.ReactElement<T>;
}
function childProps<T>(element: React.ReactElement, type: (props: T) => React.ReactNode): T {
  return childElement(element, type).props;
}

test("倍率変更中も表示キャンバスを消さず、PDF・線・文章に同じ表示倍率を使う", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.render(); await flush();
  assert.equal(f.wheel(true).defaultPrevented, false); // 初回のページ寸法が未確定。
  assert.equal(f.zoom(), 1);
  f.tasks[0].resolve(); await flush();
  const initial = f.render();
  const textKey = childElement(initial, TextLayer).key;
  assert.equal(f.canvas.style.width, "400px");
  const width = f.canvas.width;
  f.setZoom(1.5);
  const pending = f.render();
  assert.equal(f.canvas.style.width, "600px");
  assert.equal(f.canvas.width, width); // 再描画完了まで古いビットマップを保持。
  assert.equal(f.draws.length, 1);
  assert.equal(childProps(pending, PenLayer).pageScale, 1);
  assert.equal(childProps(pending, TextLayer).pageScale, 1);
  assert.equal(childProps(pending, TextLayer).disabled, false);
  assert.equal(childElement(pending, TextLayer).key, textKey); // 倍率をkeyに含めず、入力欄を保持する。
  t.mock.timers.tick(100); await flush();
  assert.notEqual(f.tasks[1].canvas, f.canvas);
  f.tasks[1].resolve(); await flush(); f.render();
  assert.equal(f.draws.length, 2);
  assert.equal(f.canvas.width, 1200);
  f.cleanup();
});

test("ホイールは指した位置、スライダーは中心を維持し、無効時はズームしない", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.render(); await flush(); f.tasks[0].resolve(); await flush(); f.render();
  assert.equal(f.wheel(false).defaultPrevented, false);
  assert.equal(f.zoom(), 1);
  f.setZoom(1.5); f.render();
  assert.equal(f.viewport.scrollLeft, 100);
  assert.ok(Math.abs(f.viewport.scrollTop - 75) < 0.001);
  const before = f.zoom();
  const x = (100 + f.viewport.scrollLeft) / parseFloat(f.canvas.style.width);
  const y = (150 + f.viewport.scrollTop) / parseFloat(f.canvas.style.height);
  assert.equal(f.wheel(true).defaultPrevented, true);
  const firstWheel = f.zoom();
  f.wheel(true); // Reactの次の描画前に届く連続入力も蓄積する。
  assert.ok(f.zoom() > firstWheel);
  f.render();
  assert.ok(f.zoom() > before);
  assert.ok(Math.abs(x * parseFloat(f.canvas.style.width) - f.viewport.scrollLeft - 100) < 0.001);
  assert.ok(Math.abs(y * parseFloat(f.canvas.style.height) - f.viewport.scrollTop - 150) < 0.001);
  f.disable(); f.render();
  assert.equal(f.wheel(true).defaultPrevented, false);
  f.cleanup();
});

test("古い描画を取り消し、遅れて完了・失敗しても最新画像やエラー表示を上書きしない", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.render(); await flush(); f.tasks[0].resolve(); await flush(); f.render();
  f.setZoom(1.2); f.render(); t.mock.timers.tick(100); await flush();
  f.setZoom(1.4); f.render();
  assert.equal(f.tasks[1].cancelled, true);
  f.tasks[1].resolve(); await flush();
  assert.equal(f.draws.length, 1);
  t.mock.timers.tick(100); await flush();
  f.setZoom(1.6); f.render();
  f.tasks[2].reject(); await flush();
  assert.equal(states[2].value, null);
  t.mock.timers.tick(100); await flush();
  f.tasks[3].resolve(); await flush(); f.render();
  assert.equal(f.draws.length, 2);
  assert.equal(f.canvas.width, 1280);
  f.cleanup();
});
