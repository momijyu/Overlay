import assert from "node:assert/strict";
import test from "node:test";
import { annotationClipboard, bindAnnotationClipboard } from "@/features/pdf-editor/annotationClipboard";
import { ANNOTATION_CLIPBOARD_TYPE } from "@/features/pdf-editor/annotationSelection";

test("PDFと設定欄だけでコピー・貼り付けを処理し、文章入力・他画面・IMEを妨げない", () => {
  const target = new EventTarget();
  let owned = true, native = false, copies = 0, clears = 0;
  const pasted: string[] = [];
  const stop = bindAnnotationClipboard(target as unknown as Window, { owns: () => owned,
    copy: () => { copies++; return { data: "objects", text: "日本語メモ" }; }, paste: (data) => pasted.push(data), clear: () => clears++ });
  function emit(type: string, entries: Record<string, string> = {}, extras = {}) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { target: { value: { closest: () => native ? {} : null } },
      clipboardData: { value: { setData: (type: string, value: string) => { entries[type] = value; }, getData: (type: string) => entries[type] ?? "" } } });
    Object.assign(event, extras); target.dispatchEvent(event); return event;
  }
  const data: Record<string, string> = {};
  assert.ok(emit("copy", data).defaultPrevented); assert.equal(data[ANNOTATION_CLIPBOARD_TYPE], "objects"); assert.equal(data["text/plain"], "日本語メモ");
  assert.ok(emit("paste", data).defaultPrevented); assert.deepEqual(pasted, ["objects"]);
  assert.equal(emit("paste", { "text/plain": "通常の文章" }).defaultPrevented, false);
  native = true;
  assert.equal(emit("copy").defaultPrevented, false); assert.equal(emit("paste", data).defaultPrevented, false);
  native = false; owned = false;
  assert.equal(emit("copy").defaultPrevented, false); assert.equal(emit("paste", data).defaultPrevented, false);
  owned = true;
  assert.equal(emit("keydown", {}, { key: "Escape", isComposing: true }).defaultPrevented, false);
  assert.ok(emit("keydown", {}, { key: "Escape", isComposing: false }).defaultPrevented);
  assert.equal(copies, 1); assert.equal(clears, 1);
  stop(); assert.equal(emit("copy").defaultPrevented, false); assert.equal(emit("paste", data).defaultPrevented, false);
});

test("ボタン用のコピーはメモリで共有し、購読解除後は通知しない", () => {
  let count = 0;
  const stop = annotationClipboard.subscribe(() => count++);
  annotationClipboard.set("one"); assert.equal(annotationClipboard.get(), "one"); assert.equal(count, 1);
  stop(); annotationClipboard.set(""); assert.equal(count, 1);
});
