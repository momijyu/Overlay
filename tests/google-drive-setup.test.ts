import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// native dialogのフォーカス・実Googleポップアップは実機で別途確認する。
let states: unknown[] = [], references: { current: unknown }[] = [], effects: (() => void | (() => void))[] = [];
let stateIndex = 0, refIndex = 0, initialRender = true;
let prepared = 0, connected = 0, disconnected = 0, disposed = 0, accounts = 0, searches = 0, creates = 0;
let authReply: () => Promise<void> = async () => {};
let preparationReply: () => Promise<void> = async () => {};
let rootReply: { id: string; name: string } | null = null;
let createFailure = false;
let authorized = false, cancelled = 0;
let token = "test-token";
const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
const account = { id: "account_A", displayName: "Test User", emailAddress: "test@example.com" };
const auth = { prepare() { prepared++; return preparationReply(); }, async connect() { connected++; authorized = false; await authReply(); authorized = true; },
  getState: () => ({ status: authorized ? "authorized" : "disconnected" }),
  disconnect() { disconnected++; authorized = false; }, getAccessToken: () => token, invalidateAccessToken: () => {} };
const drive = { async getAccount() { accounts++; return account; }, async findRoot() { searches++; return rootReply; },
  async createRoot(id: string) { assert.equal(id, account.id); creates++; if (createFailure) throw new Error("再接続してください。"); return { id: "folder_A", name: "Overlay" }; },
  cancelPending() { cancelled++; }, dispose() { disposed++; } };

mock.module("react", { exports: { ...React,
  useState(initial: unknown) {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [states[index], (value: unknown) => { states[index] = value; }];
  },
  useRef() { const index = refIndex++; return references[index] ??= { current: index === 0 ? dialog : null }; },
  useEffect(effect: () => void | (() => void)) { if (initialRender) effects.push(effect); },
} });
mock.module("@/features/pdf-editor/googleDriveAuth", { exports: { createGoogleDriveAuth: () => auth } });
mock.module("@/features/pdf-editor/googleDriveClient", { exports: { createGoogleDriveClient: () => drive } });
const { createGoogleDriveSession } = await import("@/features/pdf-editor/googleDriveSession");
let session: ReturnType<typeof createGoogleDriveSession>;
mock.module("@/features/pdf-editor/googleDriveSession", { exports: { getGoogleDriveSession: () => session } });
const { GoogleDriveSetup, GoogleDriveSetupDialog } = await import("@/features/pdf-editor/components/GoogleDriveSetup");
const { GoogleDriveNotes } = await import("@/features/pdf-editor/components/GoogleDriveNotes");

beforeEach(() => {
  states = []; references = []; effects = []; initialRender = true; stateIndex = 0; refIndex = 0;
  prepared = connected = disconnected = disposed = accounts = searches = creates = 0;
  authReply = preparationReply = async () => {}; rootReply = null; createFailure = false; dialog.open = false;
  authorized = false; cancelled = 0; token = "test-token"; session = createGoogleDriveSession();
});

function elements(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => React.isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as React.ReactNode)] : []);
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
// 接続画面のテストでは、別途検証するノート一覧のhooksを実行しない。
function shallow(node: React.ReactNode): React.ReactNode {
  return React.Children.map(node, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return child;
    if (child.type === GoogleDriveNotes) return React.createElement("section", { "aria-label": "Driveのノート" });
    return React.cloneElement(child, {}, shallow(child.props.children));
  });
}
function render(onClose = () => {}, extra: Partial<React.ComponentProps<typeof GoogleDriveSetupDialog>> = {}) {
  stateIndex = refIndex = 0;
  const node = GoogleDriveSetupDialog({ onClose, ...extra });
  initialRender = false;
  return { node, html: renderToStaticMarkup(shallow(node)), entries: elements(node) };
}
function click(label: string) {
  const button = render().entries.find((entry) => entry.type === "button" && entry.props.children === label);
  assert.ok(button, `ボタンを表示: ${label}`);
  (button.props.onClick as () => void)();
}
async function mount() {
  render(); const cleanup = effects.splice(0).map((effect) => effect()); await settle();
  return () => { cleanup.forEach((action) => action?.()); };
}

test("入口を表示するだけではSDK準備も認証もAPI通信も開始しない", () => {
  const node = GoogleDriveSetup({ disabled: false });
  assert.match(renderToStaticMarkup(node), /Google Driveの接続確認/);
  assert.equal(prepared + connected + accounts + creates, 0);
  const button = elements(node).find((entry) => entry.type === "button")!;
  (button.props.onClick as () => void)();
  assert.equal(states[0], true);
  stateIndex = 0;
  const disabled = GoogleDriveSetup({ disabled: true });
  assert.equal(elements(disabled).find((entry) => entry.type === "button")!.props.disabled, true);
});

test("開いた時だけ準備し、保存先は変わらないことを表示して、接続はクリックを待つ", async () => {
  const cleanup = await mount();
  assert.equal(dialog.open, true);
  assert.equal(prepared, 1);
  assert.equal(connected + accounts + creates, 0);
  const { html } = render();
  assert.match(html, /自動保存先はこのブラウザのまま/);
  assert.match(html, /Driveへは手動で保存/);
  assert.match(html, /Googleで接続確認/);
  assert.ok(!html.includes("専用フォルダを作成</button>"));
  cleanup();
  assert.equal(disconnected, 1); assert.equal(disposed, 0); assert.equal(cancelled, 1); assert.equal(dialog.open, false);
});

test("ユーザーのクリック内で認証を開始し、本人確認と検索だけではフォルダを作らない", async () => {
  const cleanup = await mount();
  let resolve!: () => void;
  authReply = () => new Promise((done) => { resolve = done; });
  click("Googleで接続確認");
  assert.equal(connected, 1); assert.equal(accounts, 0);
  assert.match(render().html, /接続確認中/);
  assert.ok(!render().html.includes("Googleで接続確認</button>"));
  resolve(); await settle();
  const { html } = render();
  assert.equal(accounts, 1); assert.equal(searches, 1); assert.equal(creates, 0);
  assert.doesNotMatch(html, /Test User/); assert.match(html, /test@example.com/);
  assert.match(html, /専用フォルダは未作成/);
  assert.ok(!html.includes("test-token"));
  cleanup();
});

test("フォルダ作成は追加の明示操作でのみ行い、完了後に作成ボタンを消す", async () => {
  const cleanup = await mount(); click("Googleで接続確認"); await settle();
  assert.equal(creates, 0);
  click("専用フォルダを作成"); await settle();
  assert.equal(creates, 1);
  assert.match(render().html, /専用フォルダ「Overlay」を確認しました/);
  assert.ok(!render().html.includes("専用フォルダを作成</button>"));
  cleanup();
});

test("既存フォルダの確認後は作成を提案せず、別アカウントの選択時に以前の表示を消す", async () => {
  rootReply = { id: "folder_A", name: "大学ノート" };
  const cleanup = await mount(); click("Googleで接続確認"); await settle();
  assert.match(render().html, /大学ノート/);
  assert.ok(!render().html.includes("専用フォルダを作成</button>"));
  let reject!: (error: Error) => void;
  authReply = () => new Promise((_resolve, fail) => { reject = fail; });
  click("アカウントを選び直す");
  assert.ok(!render().html.includes("test@example.com"));
  reject(new Error("接続が許可されませんでした。")); await settle();
  assert.match(render().html, /role="alert"/);
  assert.ok(!render().html.includes("大学ノート"));
  cleanup();
});

test("未設定などの準備失敗はエラーと再試行を表示し、認証や作成を始めない", async () => {
  preparationReply = async () => { throw new Error("クライアントIDを設定してください。"); };
  const cleanup = await mount();
  assert.match(render().html, /クライアントID/);
  assert.equal(connected + creates, 0);
  preparationReply = async () => {};
  click("接続準備をやり直す"); await settle();
  assert.match(render().html, /Googleで接続確認/);
  assert.equal(prepared, 2);
  cleanup();
});

test("作成失敗で再認可を案内し、成功済みやローカル保存への切替を偽装しない", async () => {
  const cleanup = await mount(); click("Googleで接続確認"); await settle();
  createFailure = true; click("専用フォルダを作成"); await settle();
  assert.match(render().html, /再接続してください/);
  assert.ok(!render().html.includes("確認したアカウント"));
  assert.ok(!render().html.includes("専用フォルダを作成</button>"));
  cleanup();
});

test("通信待ちでも閉じられ、遅れた認証応答で画面やフォルダを更新しない", async () => {
  let closed = 0;
  const cleanup = await mount();
  let resolve!: () => void;
  authReply = () => new Promise((done) => { resolve = done; });
  click("Googleで接続確認");
  const { entries } = render(() => { closed++; });
  const close = entries.find((entry) => entry.type === "button" && entry.props.children === "閉じる")!;
  assert.equal(close.props.disabled, undefined);
  (close.props.onClick as () => void)(); assert.equal(closed, 1);
  cleanup(); resolve(); await settle();
  assert.equal(disposed, 0); assert.equal(disconnected, 1); assert.equal(cancelled, 1);
  assert.equal(accounts + searches + creates, 0);
  assert.ok(!render().html.includes("確認したアカウント"));
});

test("有効な接続は閉じて開き直しても認証・本人確認を繰り返さず、期限切れ時だけ再接続する", async () => {
  rootReply = { id: "folder_A", name: "Overlay" };
  const close = await mount(); click("Googleで接続確認"); await settle(); close();
  assert.equal(disconnected, 0); assert.equal(disposed, 0);
  states = []; references = []; effects = []; initialRender = true; stateIndex = refIndex = 0;
  const again = await mount();
  assert.equal(connected, 1); assert.equal(accounts, 1); assert.equal(searches, 1);
  assert.match(render().html, /test@example.com/);
  assert.doesNotMatch(render().html, /Test User/);
  again(); authorized = false;
  states = []; references = []; effects = []; initialRender = true; stateIndex = refIndex = 0;
  const expired = await mount();
  assert.match(render().html, /Googleで接続確認/);
  assert.doesNotMatch(render().html, /test@example.com/);
  assert.equal(connected, 1); expired();
});

test("選択ノートの保存要求で画面を開き、閉じた要求を再表示せずスナップショットを解放する", () => {
  const request = { id: "request_A", backup: { schemaVersion: 1 as const, kind: "note" as const, name: "選択ノート", folders: [], notes: [] } };
  let released = 0;
  const node = GoogleDriveSetup({ saveRequest: request, onSaveRequestClose: () => { released++; } });
  const modal = elements(node).find((entry) => entry.type === GoogleDriveSetupDialog)!;
  assert.ok(modal);
  assert.equal(modal.props.saveRequest, request);
  (modal.props.onClose as () => void)();
  assert.equal(released, 1);
  stateIndex = refIndex = 0;
  const closed = GoogleDriveSetup({ saveRequest: request });
  assert.ok(!elements(closed).some((entry) => entry.type === GoogleDriveSetupDialog));
});

test("複数ノートの取得口を接続後の一覧へ渡し、認証前にPDFを読まない", async () => {
  const sources = [{ id: "note_A", title: "授業", load: async () => { throw new Error("事前に本文を取得しない"); } }];
  const request = { id: "batch_request", sources };
  rootReply = { id: "folder_A", name: "Overlay" };
  const cleanup = await mount(); click("Googleで接続確認"); await settle();
  const entries = render(() => {}, { saveRequest: request }).entries;
  const notes = entries.find((entry) => entry.type === GoogleDriveNotes)!;
  assert.equal(notes.props.batchSources, sources);
  assert.equal(notes.props.initialBackup, undefined);
  cleanup();
});

test("認可トークンが変われば古い確認済みアカウントを再利用せず、公開接続情報にトークンを含めない", () => {
  authorized = true;
  session.remember(account, { id: "folder_A", name: "Overlay" });
  assert.deepEqual(session.getConnection(), { account, root: { id: "folder_A", name: "Overlay" } });
  assert.doesNotMatch(JSON.stringify(session.getConnection()), /test-token/);
  token = "another-token";
  assert.equal(session.getConnection(), null);
  token = "test-token";
  assert.equal(session.getConnection(), null); // 不一致時に古い接続を破棄済み。
});

test("接続確認のEscapeは親のノート一覧へ伝播させない", async () => {
  const cleanup = await mount();
  let closed = 0, stopped = 0, prevented = 0;
  const modal = render(() => { closed++; }).entries.find((entry) => entry.type === "dialog")!;
  (modal.props.onCancel as (event: unknown) => void)({ preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  assert.equal(closed, 1); assert.equal(stopped, 1); assert.equal(prevented, 1);
  const close = modal.props.onClose as (event: unknown) => void;
  close({ target: dialog, currentTarget: dialog });
  assert.equal(closed, 1); // 再表示済みのdialogに遅れて来たcloseは無視。
  dialog.open = false;
  close({ target: dialog, currentTarget: dialog });
  assert.equal(closed, 2);
  cleanup();
});
