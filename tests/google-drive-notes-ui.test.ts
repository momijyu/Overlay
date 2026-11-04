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

test("接続後の表示は一覧取得だけを行い、開いているノートを勝手に送信しない", async () => {
  const cleanup = await mount();
  assert.deepEqual(listCalls, [undefined]); assert.equal(saveCalls.length + loadCalls.length + captured, 0);
  assert.match(render().html, /Driveのノートはありません/);
  assert.ok(!render({ captureNote: undefined }).html.includes("開いているノートを保存"));
  cleanup();
});

test("選択一括保存は専用の確認へつなぎ、送信中は一覧操作を止め成功分を反映する", async () => {
  const sources = [{ id: "A", title: "講義メモ", load: async () => backup }];
  render({ batchSources: sources }); const cleanups = effects.splice(0).map((effect) => effect()); await settle();
  let tree = render({ batchSources: sources });
  assert.doesNotMatch(tree.html, /開いているノートを保存/);
  const batch = tree.entries.find((entry) => entry.type === GoogleDriveBatchSave)!;
  assert.equal(batch.props.sources, sources);
  (batch.props.onBusyChange as (busy: boolean) => void)(true);
  tree = render({ batchSources: sources });
  assert.equal(tree.entries.find((entry) => entry.type === "button" && entry.props.children === "更新")!.props.disabled, true);
  (batch.props.onSaved as (note: unknown) => void)(note);
  (batch.props.onBusyChange as (busy: boolean) => void)(false);
  assert.match(render({ batchSources: sources }).html, /講義メモ/);
  assert.deepEqual(saveCalls, []); assert.equal(captured, 0);
  (batch.props.onCancel as () => void)(); assert.equal(closed, 1);
  cleanups.forEach((fn) => fn?.());
});

test("新規保存は対象名を確認してから実行し、キャンセルでは通信しない", async () => {
  const cleanup = await mount(); await choose();
  assert.equal(captured, 1); assert.equal(saveCalls.length, 0);
  assert.match(render().html, /「講義メモ」をDriveへ保存します/);
  click("キャンセル"); assert.equal(saveCalls.length, 0);
  assert.ok(!render().html.includes("Driveへ保存します")); cleanup();
});

test("承認後に1回だけ保存し、検証済み応答から一覧へ反映して再取得を待たない", async () => {
  const cleanup = await mount(); await choose(); click("保存"); await settle();
  assert.deepEqual(saveCalls, [backup]); assert.equal(listCalls.length, 1);
  assert.match(render().html, /Driveへ新規保存しました/);
  assert.match(render().html, /ブラウザへコピー/);
  assert.deepEqual(busyCalls, [true, false]); cleanup();
});

test("保存直後も既存一覧と続き情報を保持し、明示更新だけ再取得する", async () => {
  const older = { ...note, id: "older", title: "前の講義" };
  listReply = async () => ({ notes: [older], nextPageToken: "next" });
  const cleanup = await mount();
  await choose(); click("保存"); await settle();
  const rows = render().entries.filter((entry) => entry.type === "li");
  assert.equal(rows.length, 2);
  assert.match(renderToStaticMarkup(rows[0]), /講義メモ/);
  assert.match(renderToStaticMarkup(rows[1]), /前の講義/);
  assert.match(render().html, /さらに表示/);
  assert.equal(listCalls.length, 1);
  listReply = async () => ({ notes: [note, older] });
  click("更新"); await settle();
  assert.equal(listCalls.length, 2);
  assert.equal(render().entries.filter((entry) => entry.type === "li").length, 2);
  cleanup();
});

test("保存後の一覧再検索が失敗する状況でも、保存結果の表示と利用を妨げない", async () => {
  const cleanup = await mount();
  listReply = async () => { throw new Error("一覧だけ通信失敗"); };
  await choose(); click("保存"); await settle();
  assert.equal(listCalls.length, 1);
  assert.match(render().html, /Driveへ新規保存しました/);
  assert.doesNotMatch(render().html, /role="alert"/);
  click("ブラウザへコピー"); await settle();
  assert.deepEqual(loadCalls, [note.id]);
  cleanup();
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
  assert.equal(saveCalls.length, 1); assert.equal(listCalls.length, 1);
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
  assert.equal(render().entries.filter((entry) => entry.type === "li").length, 1);
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
  click("保存"); await settle();
  assert.deepEqual(saveCalls, [selected]);
  cleanup.forEach((fn) => fn?.());
});

test("一覧からの読み込みは明示操作だけで行い、確認用コピーを親へ渡して閉じる", async () => {
  listReply = async () => ({ notes: [note] });
  const cleanup = await mount(); assert.equal(loadCalls.length, 0);
  click("ブラウザへコピー"); await settle();
  assert.deepEqual(loadCalls, [note.id]); assert.deepEqual(imports, [backup]); assert.equal(closed, 1); cleanup();
});

test("読み込み失敗ではコピーを渡さず、元の画面を閉じない", async () => {
  listReply = async () => ({ notes: [note] }); loadReply = async () => { throw new Error("PDFの形式が不正です。"); };
  const cleanup = await mount(); click("ブラウザへコピー"); await settle();
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

test("閉じた後の遅いコピー結果で親の復元確認を開かない", async () => {
  listReply = async () => ({ notes: [note] });
  let release!: (value: NoteBackup) => void;
  loadReply = () => new Promise((resolve) => { release = resolve; });
  const cleanup = await mount(); click("ブラウザへコピー"); cleanup(); release(backup); await settle();
  assert.equal(imports.length, 0); assert.equal(closed, 0);
});
