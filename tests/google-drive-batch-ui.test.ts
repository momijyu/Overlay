import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NoteBackup } from "@/features/pdf-editor/noteBackupData";

let states: unknown[] = [], refs: { current: unknown }[] = [], effects: (() => void | (() => void))[] = [];
let stateIndex = 0, refIndex = 0, first = true;
mock.module("react", { exports: { ...React,
  useState(initial: unknown) {
    const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
  },
  useRef(initial: unknown) { return refs[refIndex++] ??= { current: initial }; },
  useEffect(effect: () => void | (() => void)) { if (first) effects.push(effect); },
} });
const { GoogleDriveBatchSave } = await import("@/features/pdf-editor/components/GoogleDriveBatchSave");
const note = (title: string) => ({ id: title, title, containerId: "container", noteKey: "key", updatedAt: "2026-11-04" });
const backup = (title: string): NoteBackup => ({ schemaVersion: 1, kind: "note", name: title, folders: [],
  notes: [{ id: title, title, fileName: "sample.pdf", folderId: null, pdf: new Blob(["%PDF-1.7"]), strokesByPage: {}, textsByPage: {} }] });
let sent: string[], loaded: string[], cancelled: number, failures: boolean;
let saveReply: (title: string) => Promise<ReturnType<typeof note>>;
const busy: boolean[] = [];
let sources: React.ComponentProps<typeof GoogleDriveBatchSave>["sources"];
const props = {
  drive: {
    findSaveTargetByTitle: async (_account: string, _root: string, title: string) => title === "B" ? { note: note(title), version: "1" } : null,
    saveConfirmedNote: async (_account: string, _root: string, data: NoteBackup) => { sent.push(data.name); return saveReply(data.name); },
  }, accountId: "account", rootId: "root", onBusyChange: (value: boolean) => busy.push(value), onSaved: () => {}, onCancel: () => { cancelled++; },
};
beforeEach(() => {
  states = []; refs = []; effects = []; stateIndex = refIndex = 0; first = true;
  sent = []; loaded = []; cancelled = 0; failures = false; busy.length = 0;
  sources = ["A", "B", "C"].map((title) => ({ id: title, title, load: async () => { loaded.push(title); return backup(title); } }));
  saveReply = async (title) => { if (failures && title === "B") throw new Error("通信結果を確認してください。"); return note(title); };
});
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as React.ReactNode)] : []);
}
function render(disabled = false) {
  stateIndex = refIndex = 0;
  const node = GoogleDriveBatchSave({ ...props, sources, disabled }); first = false;
  return { entries: elements(node), html: renderToStaticMarkup(node) };
}
function click(label: string, disabled = false) {
  const button = render(disabled).entries.find((entry) => entry.type === "button" && entry.props.children === label);
  assert.ok(button, label); (button.props.onClick as () => void)();
}
const settle = async () => { await new Promise(setImmediate); };
async function mount() { render(); const cleanups = effects.splice(0).map((effect) => effect()); await settle(); return () => cleanups.forEach((fn) => fn?.()); }

test("一括保存は全対象と新規・上書き、注意を確認してから開始しキャンセルもできる", async () => {
  const close = await mount();
  const html = render().html;
  assert.match(html, /ノート3件/); assert.match(html, /A/); assert.match(html, /B/); assert.match(html, /C/);
  assert.match(html, /新規/); assert.match(html, /上書き/); assert.match(html, /同名の1件を上書き/);
  assert.deepEqual(sent, []); assert.deepEqual(loaded, []);
  click("キャンセル"); assert.equal(cancelled, 1); assert.deepEqual(sent, []); close();
});

test("一括確定を二重実行せず、保存状況と完了件数を表示する", async () => {
  const close = await mount(); busy.length = 0;
  let release!: (value: ReturnType<typeof note>) => void;
  saveReply = (title) => title === "A" ? new Promise((done) => { release = done; }) : Promise.resolve(note(title));
  const button = render().entries.find((entry) => entry.type === "button" && entry.props.children === "上書きを含めて保存")!;
  (button.props.onClick as () => void)(); (button.props.onClick as () => void)(); await settle();
  assert.deepEqual(sent, ["A"]); assert.deepEqual(loaded, ["A"]);
  assert.match(render().html, /Driveへ保存中/);
  release(note("A")); await settle();
  assert.deepEqual(sent, ["A", "B", "C"]); assert.match(render().html, /3件を保存しました/);
  assert.deepEqual(busy, [true, false]); click("完了"); assert.equal(cancelled, 1); close();
});

test("途中失敗では成功と残りを表示し、残りを再確認してから保存する", async () => {
  const close = await mount(); failures = true;
  click("上書きを含めて保存"); await settle();
  assert.match(render().html, /1件保存済み・残り2件/);
  assert.match(render().html, /要確認/); assert.match(render().html, /通信結果を確認/);
  assert.deepEqual(sent, ["A", "B"]);
  failures = false; click("残りの保存先を確認"); await settle();
  assert.deepEqual(sent, ["A", "B"]);
  click("上書きを含めて保存"); await settle();
  assert.deepEqual(sent, ["A", "B", "B", "C"]); assert.match(render().html, /3件を保存しました/); close();
});

test("同名の選択は識別子付きの保存名を表示し、確認中にはPDFを読まない", async () => {
  sources[1] = { ...sources[1], title: "A" };
  const close = await mount();
  assert.match(render().html, /保存名：A \(A\)/);
  assert.match(render().html, /保存名：A \(B\)/);
  assert.match(render().html, /まとめて保存/);
  assert.deepEqual(loaded, []); assert.deepEqual(sent, []); close();
});

test("親で操作中なら保存を開始せず、閉鎖後の遅い結果を反映しない", async () => {
  const close = await mount();
  click("上書きを含めて保存", true); assert.deepEqual(sent, []);
  let release!: (value: ReturnType<typeof note>) => void;
  saveReply = () => new Promise((done) => { release = done; });
  click("上書きを含めて保存"); await settle(); close();
  release(note("A")); await settle(); assert.deepEqual(sent, ["A"]);
  assert.doesNotMatch(render().html, /3件を保存しました/);
});
