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
const { GoogleDriveNotes } = await import("@/features/pdf-editor/components/GoogleDriveNotes");
const { GoogleDriveBatchSave } = await import("@/features/pdf-editor/components/GoogleDriveBatchSave");
const note = { id: "manifest_A", title: "講義メモ", updatedAt: "2026-11-04T08:00:00Z", containerId: "folder_A", noteKey: "note_A" };
const backup: NoteBackup = { schemaVersion: 1, kind: "note", name: "講義メモ", folders: [], notes: [{ id: "note_A", title: "講義メモ", fileName: "sample.pdf",
  folderId: null, pdf: new Blob(["%PDF-1.7"]), strokesByPage: {}, textsByPage: {} }] };
let listReply: () => Promise<{ notes: typeof note[]; nextPageToken?: string }>;
let saveReply: () => Promise<typeof note>;
let loadReply: () => Promise<NoteBackup>;
let targetReply: () => Promise<{ note: typeof note; version: string } | null>;
const confirmedTargets: unknown[] = [];
const listCalls: (string | undefined)[] = [], saveCalls: NoteBackup[] = [], loadCalls: string[] = [], imports: NoteBackup[] = [], busyCalls: boolean[] = [];
let captured = 0, closed = 0;
const props = {
  drive: {
    listNotes(account: string, root: string, token?: string) { assert.equal(account, "account_A"); assert.equal(root, "root_A"); listCalls.push(token); return listReply(); },
    findSaveTarget(account: string, root: string, data: NoteBackup) { assert.equal(account, "account_A"); assert.equal(root, "root_A"); assert.ok(data.notes.length); return targetReply(); },
    findSaveTargetByTitle: async () => targetReply(),
    saveConfirmedNote(account: string, root: string, data: NoteBackup, target: unknown) { assert.equal(account, "account_A"); assert.equal(root, "root_A"); saveCalls.push(data); confirmedTargets.push(target); return saveReply(); },
    loadNote(account: string, root: string, id: string) { assert.equal(account, "account_A"); assert.equal(root, "root_A"); loadCalls.push(id); return loadReply(); },
  }, accountId: "account_A", rootId: "root_A", captureNote: () => { captured++; return backup; },
  onImportNote: (value: NoteBackup) => { imports.push(value); }, onClose: () => { closed++; }, onBusyChange: (value: boolean) => { busyCalls.push(value); },
};
beforeEach(() => {
  states = []; refs = []; effects = []; stateIndex = refIndex = 0; firstRender = true;
  captured = closed = 0; listCalls.length = saveCalls.length = loadCalls.length = imports.length = busyCalls.length = 0;
  listReply = async () => ({ notes: [] }); saveReply = async () => note; loadReply = async () => backup;
  targetReply = async () => null; confirmedTargets.length = 0;
});
function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as React.ReactNode)] : []);
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function shallow(node: React.ReactNode): React.ReactNode {
  return React.Children.map(node, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return child;
    if (child.type === GoogleDriveBatchSave) return React.createElement("section", { "aria-label": "一括保存テスト" });
    return React.cloneElement(child, {}, shallow(child.props.children));
  });
}
function render(overrides: Partial<React.ComponentProps<typeof GoogleDriveNotes>> = {}) {
  stateIndex = refIndex = 0;
  const node = GoogleDriveNotes({ ...props, ...overrides }); firstRender = false;
  return { node, html: renderToStaticMarkup(shallow(node)), entries: elements(node) };
}
function click(label: string) {
  const button = render().entries.find((entry) => entry.type === "button" && entry.props.children === label);
  assert.ok(button, label); (button.props.onClick as () => void)();
}
async function mount() {
  render(); const cleanups = effects.splice(0).map((effect) => effect()); await settle();
  return () => { cleanups.forEach((action) => action?.()); };
}
async function choose() {
  click("開いているノートを保存"); await settle();
  busyCalls.length = 0;
}

test("新規保存は対象名を確認してから実行し、キャンセルでは通信しない", async () => {
  const cleanup = await mount(); await choose();
  assert.equal(captured, 1); assert.equal(saveCalls.length, 0);
  assert.match(render().html, /「講義メモ」をDriveへ保存します/);
  click("キャンセル"); assert.equal(saveCalls.length, 0);
  assert.ok(!render().html.includes("Driveへ保存します")); cleanup();
});

test("保存待ちの二重クリックを拒否し、操作中のアカウント変更を親へロック通知する", async () => {
  const cleanup = await mount();
  let release!: (value: typeof note) => void;
  saveReply = () => new Promise((resolve) => { release = resolve; });
  await choose(); click("保存"); click("保存");
  assert.equal(saveCalls.length, 1); assert.deepEqual(busyCalls, [true]);
  assert.match(render().html, /Driveへ保存中/);
  assert.equal(render().entries.find((entry) => entry.type === "button" && entry.props.children === "保存")!.props.disabled, true);
  release(note); await settle(); assert.deepEqual(busyCalls, [true, false]); cleanup();
});

test("保存失敗は確認内容を残し、成功表示や自動再送をしない", async () => {
  const cleanup = await mount(); saveReply = async () => { throw new Error("送信失敗。再接続してください。"); };
  await choose(); click("保存"); await settle();
  assert.equal(saveCalls.length, 1); assert.equal(listCalls.length, 0);
  assert.match(render().html, /role="alert"/); assert.match(render().html, /Driveへ保存します/);
  assert.ok(!render().html.includes("Driveへ新規保存しました")); cleanup();
});

test("同名1件なら上書き注意と確認を出し、キャンセルでは更新しない", async () => {
  targetReply = async () => ({ note, version: "7" });
  const cleanup = await mount(); await choose();
  assert.match(render().html, /上書き保存します/);
  assert.match(render().html, /他の端末と同時に保存しない/);
  assert.equal(saveCalls.length, 0); click("キャンセル");
  assert.equal(saveCalls.length, 0);
  await choose(); click("上書き保存"); await settle();
  assert.deepEqual(confirmedTargets, [{ note, version: "7" }]);
  assert.match(render().html, /Driveへ上書き保存しました/);
  assert.equal(render().entries.filter((entry) => entry.type === "li").length, 0);
  cleanup();
});

test("同名の特定失敗では新規保存・上書きのどちらも開始しない", async () => {
  targetReply = async () => { throw new Error("同名ノートが複数あります"); };
  const cleanup = await mount(); await choose();
  assert.match(render().html, /同名ノートが複数/);
  assert.equal(saveCalls.length, 0);
  assert.doesNotMatch(render().html, /上書き保存します/);
  cleanup();
});

test("一覧で選んだノートは最初から確認対象になり、別の開いているノートを取得しない", async () => {
  const selected = { ...backup, name: "選択したノート", notes: [{ ...backup.notes[0], title: "選択したノート" }] };
  render({ initialBackup: selected });
  const cleanup = effects.splice(0).map((effect) => effect()); await settle();
  assert.match(render().html, /「選択したノート」をDriveへ保存します/);
  assert.equal(captured, 0); assert.equal(saveCalls.length, 0);
  assert.deepEqual(listCalls, []); // 保存先確認はコピー用一覧を取得せずに進める。
  click("保存"); await settle();
  assert.deepEqual(saveCalls, [selected]);
  cleanup.forEach((fn) => fn?.());
});

test("手動保存画面は一覧・コピーを表示せず、一覧取得なしで保存を完了する", async () => {
  listReply = async () => { throw new Error("一覧を取得しない"); };
  const cleanup = await mount();
  assert.doesNotMatch(render().html, /Driveからコピー|復元|ブラウザへコピー/);
  await choose(); click("保存"); await settle();
  assert.deepEqual(saveCalls, [backup]); assert.equal(listCalls.length, 0); assert.equal(loadCalls.length, 0);
  assert.match(render().html, /Driveへ新規保存しました/); assert.doesNotMatch(render().html, /role="alert"/);
  assert.deepEqual(busyCalls, [true, false]); cleanup();
});

test("一括保存は選択済みの取得口へ接続し、一覧を取得せず閉じられる", async () => {
  const sources = [{ id: "A", title: "講義メモ", load: async () => backup }];
  const tree = render({ batchSources: sources });
  const cleanups = effects.splice(0).map((effect) => effect()); await settle();
  const batch = tree.entries.find((entry) => entry.type === GoogleDriveBatchSave)!;
  assert.equal(batch.props.sources, sources); assert.doesNotMatch(tree.html, /開いているノートを保存|ブラウザへコピー/);
  (batch.props.onBusyChange as (value: boolean) => void)(true);
  assert.deepEqual(busyCalls, [true]);
  (batch.props.onSaved as (value: unknown) => void)(note);
  (batch.props.onBusyChange as (value: boolean) => void)(false);
  (batch.props.onCancel as () => void)();
  assert.deepEqual(listCalls, []); assert.equal(captured, 0); assert.equal(closed, 1);
  cleanups.forEach((action) => action?.());
});
