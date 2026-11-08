import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NoteBackup } from "@/features/pdf-editor/noteBackupData";

let states: unknown[] = [], refs: { current: unknown }[] = [], effects: (() => void | (() => void))[] = [];
let stateIndex = 0, refIndex = 0, firstRender = true;
mock.module("react", { exports: { ...React,
  useCallback: (callback: unknown) => callback,
  useState(initial: unknown) {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], (value: unknown) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
  },
  useRef(initial: unknown) { return refs[refIndex++] ??= { current: initial }; },
  useEffect(effect: () => void | (() => void)) { if (firstRender) effects.push(effect); },
} });
const { GoogleDriveBackupRestore } = await import("@/features/pdf-editor/components/GoogleDriveBackupRestore");
const note = { id: "manifest_A", title: "講義メモ", updatedAt: "2026-11-04T08:00:00Z", containerId: "folder_A", noteKey: "note_A" };
const backup: NoteBackup = { schemaVersion: 1, kind: "note", name: "講義メモ", folders: [], notes: [{ id: "note_A", title: "講義メモ", fileName: "sample.pdf",
  folderId: null, pdf: new Blob(["%PDF-1.7"]), strokesByPage: {}, textsByPage: {} }] };
let listReply: () => Promise<{ notes: typeof note[]; nextPageToken?: string }>;
let saveReply: () => Promise<typeof note>;
let loadReply: () => Promise<NoteBackup>;
let targetReply: () => Promise<{ note: typeof note; version: string } | null>;
const confirmedTargets: unknown[] = [];
const listCalls: (string | undefined)[] = [], saveCalls: NoteBackup[] = [], loadCalls: string[] = [], imports: NoteBackup[] = [], busyCalls: boolean[] = [];
let closed = 0;
const props = {
  drive: {
    listNotes(account: string, root: string, token?: string) { assert.equal(account, "account_A"); assert.equal(root, "root_A"); listCalls.push(token); return listReply(); },
    findSaveTarget(account: string, root: string, data: NoteBackup) { assert.equal(account, "account_A"); assert.equal(root, "root_A"); assert.ok(data.notes.length); return targetReply(); },
    findSaveTargetByTitle: async () => targetReply(),
    saveConfirmedNote(account: string, root: string, data: NoteBackup, target: unknown) { assert.equal(account, "account_A"); assert.equal(root, "root_A"); saveCalls.push(data); confirmedTargets.push(target); return saveReply(); },
    loadNote(account: string, root: string, id: string) { assert.equal(account, "account_A"); assert.equal(root, "root_A"); loadCalls.push(id); return loadReply(); },
  }, accountId: "account_A", rootId: "root_A",
  onImportNote: (value: NoteBackup) => { imports.push(value); }, onClose: () => { closed++; }, onBusyChange: (value: boolean) => { busyCalls.push(value); },
};
beforeEach(() => {
  states = []; refs = []; effects = []; stateIndex = refIndex = 0; firstRender = true;
  closed = 0; listCalls.length = saveCalls.length = loadCalls.length = imports.length = busyCalls.length = 0;
  listReply = async () => ({ notes: [] }); saveReply = async () => note; loadReply = async () => backup;
  targetReply = async () => null; confirmedTargets.length = 0;
});
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as React.ReactNode)] : []);
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function render(overrides: Partial<React.ComponentProps<typeof GoogleDriveBackupRestore>> = {}) {
  stateIndex = refIndex = 0;
  const node = GoogleDriveBackupRestore({ ...props, ...overrides }); firstRender = false;
  return { node, html: renderToStaticMarkup(node), entries: elements(node) };
}
function click(label: string) {
  const button = render().entries.find((entry) => entry.type === "button" && entry.props.children === label);
  assert.ok(button, label); (button.props.onClick as () => void)();
}
async function mount() {
  render(); const cleanups = effects.splice(0).map((effect) => effect()); await settle();
  return () => { cleanups.forEach((action) => action?.()); };
}

test("復元一覧は保存日時で区別し、端末IDを画面へ表示しない", async () => {
  const privateId = "device_12345678";
  listReply = async () => ({ notes: [{ ...note, deviceId: privateId }, { ...note, id: "unknown_date", updatedAt: "invalid" }] });
  const cleanup = await mount();
  const html = render().html;
  assert.match(html, /保存日時：2026\/11\/4/);
  assert.match(html, /保存日時：不明/);
  assert.doesNotMatch(html, /device_12345678|device_1|Invalid Date/);
  cleanup();
});

test("画面を閉じた後の遅い一覧応答は表示へ反映しない", async () => {
  let release!: (page: { notes: typeof note[] }) => void;
  listReply = () => new Promise((resolve) => { release = resolve; });
  const cleanup = await mount();
  cleanup(); release({ notes: [note] }); await settle();
  assert.doesNotMatch(render().html, /講義メモ/);
  assert.deepEqual(loadCalls, []);
});

test("一覧からの読み込みは明示操作だけで行い、確認用コピーを親へ渡して閉じる", async () => {
  listReply = async () => ({ notes: [note] });
  const cleanup = await mount(); assert.equal(loadCalls.length, 0);
  click("復元"); await settle();
  assert.deepEqual(loadCalls, [note.id]); assert.deepEqual(imports, [backup]); assert.equal(closed, 1); cleanup();
});

test("読み込み失敗ではコピーを渡さず、元の画面を閉じない", async () => {
  listReply = async () => ({ notes: [note] }); loadReply = async () => { throw new Error("PDFの形式が不正です。"); };
  const cleanup = await mount(); click("復元"); await settle();
  assert.equal(imports.length, 0); assert.equal(closed, 0); assert.match(render().html, /PDFの形式が不正/); cleanup();
});

test("一覧の続きは利用者が押して取得し、同じIDの重なりを二重表示しない", async () => {
  listReply = async () => ({ notes: [note], nextPageToken: "page_B" });
  const cleanup = await mount(); assert.deepEqual(listCalls, [undefined]);
  listReply = async () => ({ notes: [note, { ...note, id: "manifest_B", title: "別の講義" }] });
  click("さらに表示"); await settle();
  assert.deepEqual(listCalls, [undefined, "page_B"]);
  assert.equal(render().entries.filter((entry) => entry.type === "li").length, 2);
  assert.ok(!render().html.includes("さらに表示")); cleanup();
});

test("最初の一覧取得が失敗しても更新から再試行できる", async () => {
  listReply = async () => { throw new Error("接続期限が切れました。"); };
  const cleanup = await mount(); assert.match(render().html, /接続期限/);
  listReply = async () => ({ notes: [note] }); click("更新"); await settle();
  assert.match(render().html, /講義メモ/); assert.ok(!render().html.includes("role=\"alert\"")); cleanup();
});

test("閉じた後の遅い復元結果で親の復元確認を開かない", async () => {
  listReply = async () => ({ notes: [note] });
  let release!: (value: NoteBackup) => void;
  loadReply = () => new Promise((resolve) => { release = resolve; });
  const cleanup = await mount(); click("復元"); cleanup(); release(backup); await settle();
  assert.equal(imports.length, 0); assert.equal(closed, 0);
});

test("復元待ちの二重操作を拒否し、実データを書き換えず確認へ渡す", async () => {
  listReply = async () => ({ notes: [note] });
  let release!: (value: NoteBackup) => void;
  loadReply = () => new Promise((resolve) => { release = resolve; });
  const cleanup = await mount(); busyCalls.length = 0;
  click("復元"); click("復元"); click("更新");
  assert.equal(loadCalls.length, 1); assert.equal(listCalls.length, 1);
  assert.deepEqual(imports, []); assert.deepEqual(saveCalls, []);
  release(backup); await settle();
  assert.deepEqual(imports, [backup]); assert.deepEqual(busyCalls, [true, false]); cleanup();
});

test("同じ次ページトークンは取得を繰り返さずエラー表示する", async () => {
  listReply = async () => ({ notes: [note], nextPageToken: "same" });
  const cleanup = await mount(); click("さらに表示"); await settle();
  assert.equal(listCalls.length, 2); assert.match(render().html, /続き情報を確認できません/); cleanup();
});

test("Strict Modeのeffect再実行でも一覧通信を二重に始めない", async () => {
  render(); const effect = effects.shift()!;
  const cleanup = effect(); cleanup?.();
  const finalCleanup = effect(); await settle();
  assert.deepEqual(listCalls, [undefined]); assert.deepEqual(loadCalls, []);
  finalCleanup?.();
});
