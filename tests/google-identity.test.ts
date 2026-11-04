import assert from "node:assert/strict";
import test, { afterEach, beforeEach, mock } from "node:test";
import { loadGoogleIdentity, type GoogleOAuth2 } from "@/features/pdf-editor/googleIdentity";

const descriptors = new Map<string, PropertyDescriptor | undefined>();
const identity: GoogleOAuth2 = { initTokenClient: () => ({ requestAccessToken() {} }) };
let scripts: FakeScript[];
let fakeWindow: { isSecureContext: boolean; google?: { accounts: { oauth2: GoogleOAuth2 } } };

class FakeScript extends EventTarget {
  id = "";
  src = "";
  async = false;
  referrerPolicy = "";
  removed = false;
  remove() { this.removed = true; }
}

function setGlobal(name: string, value: unknown) {
  if (!descriptors.has(name)) descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

beforeEach(() => {
  scripts = [];
  fakeWindow = { isSecureContext: true };
  setGlobal("window", fakeWindow);
  setGlobal("HTMLScriptElement", FakeScript);
  setGlobal("document", {
    getElementById: (id: string) => scripts.find((script) => !script.removed && script.id === id),
    createElement: () => new FakeScript(),
    head: { append: (script: FakeScript) => { scripts.push(script); } },
  });
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  descriptors.clear();
});

test("同時の準備はSDKを1回だけ読み込み、成功後は既存SDKを使う", async () => {
  const first = loadGoogleIdentity();
  const second = loadGoogleIdentity();
  assert.equal(first, second);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, "https://accounts.google.com/gsi/client");
  assert.equal(scripts[0].async, true);
  fakeWindow.google = { accounts: { oauth2: identity } };
  scripts[0].dispatchEvent(new Event("load"));
  assert.equal(await first, identity);
  assert.equal(await loadGoogleIdentity(), identity);
  assert.equal(scripts.length, 1);
});

test("SDKの通信失敗は読み込み状態を解除し、次の操作で再試行できる", async () => {
  const first = loadGoogleIdentity();
  const rejected = assert.rejects(first, /接続準備に失敗/);
  scripts[0].dispatchEvent(new Event("error"));
  await rejected;
  assert.equal(scripts[0].removed, true);
  const second = loadGoogleIdentity();
  assert.equal(scripts.length, 2);
  fakeWindow.google = { accounts: { oauth2: identity } };
  scripts[1].dispatchEvent(new Event("load"));
  assert.equal(await second, identity);
});

test("読み込み完了でもSDKがなければ失敗とし、既存のscriptは勝手に削除しない", async () => {
  const existing = new FakeScript();
  existing.id = "overlay-google-identity";
  existing.src = "https://accounts.google.com/gsi/client";
  scripts.push(existing);
  const pending = loadGoogleIdentity();
  const rejected = assert.rejects(pending, /接続準備に失敗/);
  existing.dispatchEvent(new Event("load"));
  await rejected;
  assert.equal(scripts.length, 1);
  assert.equal(existing.removed, false);
});

test("読み込み時間切れの後に遅れてloadしても、次の試行へ影響しない", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const first = loadGoogleIdentity();
  const rejected = assert.rejects(first, /接続準備に失敗/);
  mock.timers.tick(15_000);
  await rejected;
  assert.equal(scripts[0].removed, true);
  const second = loadGoogleIdentity();
  scripts[0].dispatchEvent(new Event("load"));
  fakeWindow.google = { accounts: { oauth2: identity } };
  scripts[1].dispatchEvent(new Event("load"));
  assert.equal(await second, identity);
});

test("ブラウザ外と安全でない接続ではSDKを追加しない", async () => {
  fakeWindow.isSecureContext = false;
  await assert.rejects(loadGoogleIdentity(), /HTTPSまたはlocalhost/);
  setGlobal("window", undefined);
  await assert.rejects(loadGoogleIdentity(), /ブラウザ/);
  assert.equal(scripts.length, 0);
});

test("同じIDに別のスクリプトがある場合、再利用も削除もしない", async () => {
  const existing = new FakeScript();
  existing.id = "overlay-google-identity";
  existing.src = "https://example.com/other.js";
  scripts.push(existing);
  await assert.rejects(loadGoogleIdentity(), /再読み込み/);
  assert.equal(scripts.length, 1);
  assert.equal(existing.removed, false);
});
