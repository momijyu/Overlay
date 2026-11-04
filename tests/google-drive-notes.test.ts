import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createGoogleDriveClient } from "@/features/pdf-editor/googleDriveClient";
import { DRIVE_NOTE_SUFFIX } from "@/features/pdf-editor/googleDriveNoteData";
import { listDriveNotes } from "@/features/pdf-editor/googleDriveNotes";
import type { NoteBackup } from "@/features/pdf-editor/noteBackupData";

const root = { id: "root_A", name: "Overlay", mimeType: "application/vnd.google-apps.folder", ownedByMe: true, trashed: false,
  appProperties: { overlayApp: "overlay", overlayRole: "root", overlaySchema: "1" } };
const backup: NoteBackup = { schemaVersion: 1, kind: "note", name: "講義メモ", folders: [], notes: [{ id: "local_A", title: "講義メモ",
  fileName: "授業.pdf", folderId: null, pdf: new Blob(["%PDF-1.7\noriginal pdf bytes"], { type: "application/pdf" }),
  strokesByPage: { 2: [{ width: 0.005, color: "#ff0000", kind: "marker", points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] }] },
  textsByPage: { 2: [{ id: "text_A", kind: "sticky", text: "試験範囲\n確認", x: 0.2, y: 0.3, width: 0.3, autoSize: true, fontSize: 18,
    color: "#112233", backgroundColor: "#ffff00" }] } }] };
type Stored = Record<string, unknown> & { id: string; data?: Blob; appProperties: Record<string, string> };
type Call = { url: URL; init: RequestInit };
const clients: ReturnType<typeof createGoogleDriveClient>[] = [];
afterEach(() => { clients.splice(0).forEach((client) => client.dispose()); });

async function multipart(call: Call): Promise<{ metadata: Record<string, unknown> & { appProperties: Record<string, string> }; data: Blob }> {
  assert.ok(call.init.body instanceof Blob);
  const contentType = (call.init.headers as Record<string, string>)["Content-Type"];
  assert.match(contentType, /^multipart\/related; boundary=overlay_[\w-]+$/);
  const boundary = contentType.split("boundary=")[1];
  const body = await call.init.body.text();
  const parts = body.split(`--${boundary}`);
  assert.equal(parts.length, 4);
  assert.equal(parts[0], ""); assert.equal(parts[3], "--\r\n");
  assert.ok(parts[1].startsWith("\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"));
  assert.ok(parts[2].startsWith("\r\nContent-Type: application/json\r\n\r\n"));
  return { metadata: JSON.parse(parts[1].split("\r\n\r\n")[1].slice(0, -2)),
    data: new Blob([parts[2].split("\r\n\r\n")[1].slice(0, -2)], { type: "application/json" }) };
}

function fixture() {
  const files = new Map<string, Stored>();
  const sessions = new Map<string, Stored>();
  const calls: Call[] = [];
  let serial = 0;
  let token: string | null = "token_A";
  let intercept: ((call: Call) => Promise<Response | undefined>) | undefined;
  const auth = { getAccessToken() { if (!token) throw new Error("再接続してください。"); return token; },
    invalidateAccessToken(value: string) { if (token === value) token = null; } };
  const requestFetch = (async (input: string, init: RequestInit) => {
    const call = { url: new URL(input), init }; calls.push(call);
    assert.equal(call.url.origin, "https://www.googleapis.com");
    assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    const alternate = await intercept?.(call);
    if (alternate) return alternate;
    const { url } = call;
    if (url.pathname === "/drive/v3/about") return Response.json({ user: { permissionId: "account_A", displayName: "Test User", emailAddress: "test@example.com", me: true } });
    if (url.pathname === "/drive/v3/files" && init.method === "GET") {
      if (url.searchParams.get("q")?.includes("value='root'")) return Response.json({ files: [root] });
      const match = url.searchParams.get("q")?.match(/and name = '((?:\\.|[^'])*)'$/);
      const name = match?.[1].replace(/\\(['\\])/g, "$1");
      return Response.json({ files: [...files.values()].filter((file) => file.appProperties.overlayRole === "note"
        && (name === undefined || file.name === name)).map(metadata) });
    }
    if (url.pathname === "/drive/v3/files" && init.method === "POST") {
      const file = { ...JSON.parse(String(init.body)), id: `file_${++serial}`, ownedByMe: true, trashed: false, version: "1" } as Stored;
      files.set(file.id, file); return Response.json(metadata(file));
    }
    if (url.pathname === "/upload/drive/v3/files" && init.method === "POST") {
      if (url.searchParams.get("uploadType") === "multipart") {
        const { metadata: details, data } = await multipart(call);
        const file = { ...details, id: `file_${++serial}`, ownedByMe: true, trashed: false,
          data, size: String(data.size), version: "1", modifiedTime: "2026-11-04T08:00:00.000Z" } as Stored;
        files.set(file.id, file); return Response.json(metadata(file));
      }
      const file = { ...JSON.parse(String(init.body)), id: `file_${++serial}`, ownedByMe: true, trashed: false } as Stored;
      sessions.set(file.id, file);
      return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${file.id}` } });
    }
    if (url.pathname.startsWith("/upload/drive/v3/files/") && init.method === "PATCH") {
      const stored = files.get(url.pathname.split("/").at(-1)!)!;
      if (url.searchParams.get("uploadType") === "resumable") {
        sessions.set(stored.id, { ...stored, ...JSON.parse(String(init.body)) });
        return new Response(null, { headers: { Location: `https://www.googleapis.com${url.pathname}?upload_id=${stored.id}` } });
      }
      assert.equal(url.searchParams.get("uploadType"), "media");
      assert.ok(init.body instanceof Blob);
      stored.data = init.body; stored.size = String(init.body.size); stored.version = String(BigInt(String(stored.version)) + BigInt(1));
      stored.modifiedTime = "2026-11-04T09:00:00.000Z";
      return Response.json(metadata(stored));
    }
    if (url.pathname.startsWith("/upload/drive/v3/files") && init.method === "PUT") {
      const file = sessions.get(url.searchParams.get("upload_id")!)!;
      assert.ok(file); assert.ok(init.body instanceof Blob);
      file.data = init.body; file.size = String(init.body.size); file.modifiedTime = "2026-11-04T08:00:00.000Z";
      file.version = String(BigInt(String(file.version ?? "0")) + BigInt(1));
      file.sha256Checksum = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.data.arrayBuffer()))]
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
      files.set(file.id, file); sessions.delete(file.id); return Response.json(metadata(file));
    }
    if (url.pathname.startsWith("/drive/v3/files/")) {
      const file = files.get(url.pathname.split("/").at(-1)!);
      if (!file) return Response.json({}, { status: 404 });
      if (url.searchParams.get("alt") === "media") return new Response(file.data!, { headers: { "Content-Length": String(file.data!.size) } });
      return Response.json(metadata(file));
    }
    throw new Error("想定外の通信");
  }) as typeof fetch;
  const client = createGoogleDriveClient(auth, requestFetch);
  clients.push(client);
  return { client, files, calls, intercept: (handler: typeof intercept) => { intercept = handler; }, changeToken: (value: string | null) => { token = value; },
    newClient() { const next = createGoogleDriveClient(auth, requestFetch); clients.push(next); return next; } };
}
function metadata(file: Stored) { const { data: _data, ...value } = file; void _data; return value; }
async function verified() { const f = fixture(); await f.client.getAccount(); return f; }
const save = (f: Awaited<ReturnType<typeof verified>>, value = backup) => f.client.saveNewNote("account_A", root.id, value);
const list = (f: Awaited<ReturnType<typeof verified>>) => f.client.listNotes("account_A", root.id);

test("元PDFと編集JSONを別々に新規保存し、手書き・文章・色を含めて読み戻せる", async () => {
  const f = await verified();
  const saved = await save(f);
  assert.equal(saved.title, "講義メモ");
  const stored = [...f.files.values()];
  assert.equal(stored.length, 3);
  assert.equal(stored.filter((file) => file.mimeType === "application/pdf").length, 1);
  assert.equal(stored.filter((file) => file.mimeType === "application/json").length, 1);
  assert.equal(await stored.find((file) => file.mimeType === "application/pdf")!.data!.text(), await backup.notes[0].pdf.text());
  const restored = await f.client.loadNote("account_A", root.id, saved.id);
  assert.equal(restored.notes[0].title, backup.notes[0].title);
  assert.equal(restored.notes[0].fileName, backup.notes[0].fileName);
  assert.deepEqual(restored.notes[0].strokesByPage, backup.notes[0].strokesByPage);
  assert.deepEqual(restored.notes[0].textsByPage, backup.notes[0].textsByPage);
  assert.equal(await restored.notes[0].pdf.text(), await backup.notes[0].pdf.text());
  assert.ok(f.calls.every(({ init }) => !["PATCH", "DELETE"].includes(String(init.method))));
  assert.ok(!JSON.stringify(stored.map(metadata)).includes("token_A"));
});

test("一覧取得ではPDFやJSON本文をダウンロードせず、50件単位のメタデータだけを読む", async () => {
  const f = await verified(); await save(f); f.calls.length = 0;
  const page = await list(f);
  assert.equal(page.notes.length, 1);
  assert.ok(f.calls.every(({ init, url }) => init.method === "GET" && url.searchParams.get("alt") !== "media"));
  const query = f.calls.at(-1)!.url;
  assert.equal(query.searchParams.get("pageSize"), "50");
  assert.ok(query.searchParams.get("q")!.includes(root.id));
});

test("再度の明示保存は別ノートになり、前回のDriveデータや入力元を書き換えない", async () => {
  const f = await verified(); const first = await save(f); const second = await save(f);
  assert.notEqual(first.id, second.id); assert.notEqual(first.containerId, second.containerId);
  assert.equal((await list(f)).notes.length, 2);
  assert.equal(backup.notes[0].id, "local_A");
});

test("不正な入力・複数ノート・PDF以外はアップロード前に拒否する", async () => {
  for (const input of [{ ...backup, kind: "selection", schemaVersion: 2 } as NoteBackup,
    { ...backup, notes: [{ ...backup.notes[0], title: "" }] },
    { ...backup, notes: [{ ...backup.notes[0], pdf: new Blob(["not pdf"]) }] }]) {
    const f = await verified(); await assert.rejects(save(f, input));
    assert.ok(f.calls.every(({ init }) => init.method === "GET"));
  }
});

test("PDF送信失敗時は完成ノートを一覧に載せず、JSONの送信や自動削除・再送をしない", async () => {
  const f = await verified();
  f.intercept(async ({ init }) => init.method === "PUT" ? Response.json({ error: "private-token" }, { status: 500 }) : undefined);
  await assert.rejects(save(f), /失敗/);
  assert.equal((await list(f)).notes.length, 0);
  assert.equal(f.calls.filter(({ init }) => init.method === "PUT").length, 1);
  assert.equal(f.files.size, 1); // 未完成フォルダは残す。既存データを巻き込んで削除しない。
});

test("最後のJSON送信の結果が不明なら自動で重複保存せず、更新した一覧で発見できる", async () => {
  const f = await verified();
  let jsonSends = 0;
  // サーバーが保存したあとに応答だけ失うケース。
  f.intercept(async ({ url, init }) => {
    if (init.method === "POST" && url.searchParams.get("uploadType") === "multipart") {
      jsonSends++;
      const first = [...f.files.values()].find((file) => file.appProperties.overlayRole === "pdf")!;
      const { data } = await multipart({ url, init });
      const manifest = JSON.parse(await data.text());
      f.files.set("completed_json", { id: "completed_json", name: `講義メモ${DRIVE_NOTE_SUFFIX}`, mimeType: "application/json", ownedByMe: true, trashed: false,
        parents: first.parents, modifiedTime: "2026-11-04T08:00:00.000Z", size: String(data.size), data,
        appProperties: { ...first.appProperties, overlayRole: "note", overlayNoteKey: manifest.noteKey } });
      throw new Error("private-token");
    }
    return undefined;
  });
  await assert.rejects(save(f), /一覧を更新/);
  assert.equal((await list(f)).notes.length, 1);
  assert.equal(jsonSends, 1);
});

test("小さい編集JSONは1回、PDFは2回の送信を維持し新規保存を合計5通信へ減らす", async () => {
  const f = await verified(); f.calls.length = 0;
  await save(f);
  assert.equal(f.calls.length, 5); // ルート確認・コンテナ作成・PDF初期化・PDF本文・JSON一括。
  assert.equal(f.calls.filter(({ url }) => url.searchParams.get("uploadType") === "multipart").length, 1);
  assert.equal(f.calls.filter(({ url }) => url.searchParams.get("uploadType") === "resumable" && !url.searchParams.has("upload_id")).length, 1);
  const file = [...f.files.values()].find((file) => file.appProperties.overlayRole === "note")!;
  const manifest = JSON.parse(await file.data!.text());
  assert.deepEqual(manifest.textsByPage, backup.notes[0].textsByPage);
  assert.deepEqual(manifest.strokesByPage, backup.notes[0].strokesByPage);
  assert.ok(f.calls.every(({ init }) => !(init.headers as Record<string, string>)["Content-Length"]));
});

test("同名ノートの確認後に上書きし、同じ元PDFは再送せず編集JSONだけ更新する", async () => {
  const f = await verified(); const saved = await save(f);
  const target = await f.client.findSaveTarget("account_A", root.id, backup);
  assert.equal(target?.note.id, saved.id);
  const changed = { ...backup, notes: [{ ...backup.notes[0], strokesByPage: {} }] };
  f.calls.length = 0;
  const updated = await f.client.saveConfirmedNote("account_A", root.id, changed, target);
  assert.equal(updated.id, saved.id); assert.equal(f.files.size, 3);
  assert.equal(f.calls.filter(({ init }) => init.method === "PATCH").length, 1);
  assert.equal(f.calls.filter(({ init }) => init.method === "POST" || init.method === "PUT").length, 0);
  assert.equal(f.calls.filter(({ url }) => url.searchParams.get("alt") === "media").length, 1); // JSONのみ。
  const loaded = await f.client.loadNote("account_A", root.id, updated.id);
  assert.deepEqual(loaded.notes[0].strokesByPage, {});
  assert.deepEqual(loaded.notes[0].textsByPage, backup.notes[0].textsByPage);
  assert.equal((await list(f)).notes.length, 1);
});

test("同名でも別PDFなら新しいPDFを送り、JSON完了後に参照を切り替えて古いPDFは削除しない", async () => {
  const f = await verified(); const saved = await save(f);
  const oldPdf = [...f.files.values()].find((file) => file.appProperties.overlayRole === "pdf")!;
  const target = await f.client.findSaveTarget("account_A", root.id, backup);
  const changed = { ...backup, notes: [{ ...backup.notes[0], pdf: new Blob(["%PDF-1.7\nchanged pdf bytes"]) }] };
  await f.client.saveConfirmedNote("account_A", root.id, changed, target);
  assert.equal(f.files.size, 4);
  assert.equal(await f.files.get(oldPdf.id)!.data!.text(), await backup.notes[0].pdf.text());
  assert.equal((await list(f)).notes.length, 1);
  const loaded = await f.client.loadNote("account_A", root.id, saved.id);
  assert.equal(await loaded.notes[0].pdf.text(), await changed.notes[0].pdf.text());
  assert.ok(!f.calls.some(({ init }) => init.method === "DELETE"));
});

test("同名が複数・検索未完了なら選ばず、確認後に新しい同名ができても無断で保存しない", async () => {
  const f = await verified();
  assert.equal(await f.client.findSaveTarget("account_A", root.id, backup), null);
  await save(f);
  await assert.rejects(f.client.saveConfirmedNote("account_A", root.id, backup, null), /同名ノートが追加/);
  await save(f);
  await assert.rejects(f.client.findSaveTarget("account_A", root.id, backup), /同名ノート/);
  f.intercept(async ({ url }) => url.searchParams.get("q")?.includes("and name =") ? Response.json({ files: [], incompleteSearch: true }) : undefined);
  await assert.rejects(f.client.findSaveTarget("account_A", root.id, backup), /同名ノート/);
});

test("同名の検索はアプリ専用ルートへ限定し、引用符・バックスラッシュ入りの名前もそのまま照合する", async () => {
  const f = await verified();
  const named = { ...backup, notes: [{ ...backup.notes[0], title: "John's \\ 資料" }] };
  const saved = await f.client.saveConfirmedNote("account_A", root.id, named, null);
  const target = await f.client.findSaveTarget("account_A", root.id, named);
  assert.equal(target?.note.id, saved.id);
  const query = f.calls.at(-1)!.url.searchParams.get("q")!;
  assert.ok(query.includes("John\\'s \\\\ 資料"));
  assert.ok(query.includes(root.id)); assert.ok(query.includes("'me' in owners"));
});

test("確認後のJSON変更・元PDF変更を検出して上書きを止める", async () => {
  for (const change of ["json-before", "json-during", "pdf-during"] as const) {
    const f = await verified(); const saved = await save(f);
    const target = await f.client.findSaveTarget("account_A", root.id, backup);
    const json = f.files.get(saved.id)!;
    const pdf = [...f.files.values()].find((file) => file.appProperties.overlayRole === "pdf")!;
    const original = await json.data!.text();
    if (change === "json-before") json.version = "9";
    let jsonReads = 0, pdfReads = 0;
    f.intercept(async ({ url }) => {
      if (url.pathname.endsWith(`/${saved.id}`) && !url.searchParams.has("alt") && ++jsonReads === 2 && change === "json-during") json.version = "9";
      if (url.pathname.endsWith(`/${pdf.id}`) && !url.searchParams.has("alt") && ++pdfReads === 2 && change === "pdf-during") pdf.version = "9";
      return undefined;
    });
    await assert.rejects(f.client.saveConfirmedNote("account_A", root.id, backup, target), /変更/);
    assert.equal(await json.data!.text(), original);
    assert.equal(f.calls.filter(({ init }) => init.method === "PATCH").length, 0);
  }
});

test("上書き送信の失敗では元のJSONを維持し、自動再送やローカルデータの変更をしない", async () => {
  const f = await verified(); const saved = await save(f);
  const target = await f.client.findSaveTarget("account_A", root.id, backup);
  const before = await f.files.get(saved.id)!.data!.text();
  f.intercept(async ({ init }) => init.method === "PATCH" ? Response.json({}, { status: 500 }) : undefined);
  await assert.rejects(f.client.saveConfirmedNote("account_A", root.id, backup, target), /失敗/);
  assert.equal(await f.files.get(saved.id)!.data!.text(), before);
  assert.equal(f.calls.filter(({ init }) => init.method === "PATCH").length, 1);
  assert.equal(backup.notes[0].id, "local_A");
});

test("上書き対象の所有者・親・版・名前・アカウントの不一致を拒否する", async () => {
  for (const change of ["owner", "parent", "version", "title", "account"] as const) {
    const f = await verified(); const saved = await save(f);
    const target = await f.client.findSaveTarget("account_A", root.id, backup);
    if (change === "owner") f.files.get(saved.id)!.ownedByMe = false;
    if (change === "parent") f.files.get(saved.containerId)!.parents = ["other_root"];
    if (change === "version") f.files.get(saved.id)!.version = "invalid";
    const input = change === "title" ? { ...backup, notes: [{ ...backup.notes[0], title: "別名" }] } : backup;
    await assert.rejects(f.client.saveConfirmedNote(change === "account" ? "other_account" : "account_A", root.id, input, target));
    assert.equal(f.calls.filter(({ init }) => init.method === "PATCH").length, 0);
  }
});

test("大きいJSONの上書きは対象IDのresumable更新を使い、元PDFを再送しない", async () => {
  const f = await verified(); const saved = await save(f);
  const target = await f.client.findSaveTarget("account_A", root.id, backup);
  const large: NoteBackup = { ...backup, notes: [{ ...backup.notes[0], strokesByPage: {
    1: [{ width: 2, points: Array.from({ length: 70_000 }, (_, index) => ({ x: index / 70_000, y: 0.5 })) }],
  } }] };
  f.calls.length = 0;
  await f.client.saveConfirmedNote("account_A", root.id, large, target);
  assert.equal(f.files.size, 3);
  assert.ok(f.calls.some(({ url, init }) => init.method === "PATCH" && url.pathname.endsWith(saved.id) && url.searchParams.get("uploadType") === "resumable"));
  assert.equal(f.calls.filter(({ init }) => init.method === "POST").length, 0);
  const loaded = await f.client.loadNote("account_A", root.id, saved.id);
  assert.deepEqual(loaded.notes[0].strokesByPage, large.notes[0].strokesByPage);
});

test("同時の一覧・保存先確認はルートの検索中通信だけ共有し、完了後は再検証する", async () => {
  const f = await verified();
  f.intercept(async ({ url }) => {
    if (url.searchParams.get("q")?.includes("value='root'")) await new Promise(setImmediate);
    return undefined;
  });
  await Promise.all([f.client.listNotes("account_A", root.id), f.client.findSaveTarget("account_A", root.id, backup)]);
  const roots = () => f.calls.filter(({ url }) => url.searchParams.get("q")?.includes("value='root'"));
  assert.equal(roots().length, 1);
  await f.client.listNotes("account_A", root.id);
  assert.equal(roots().length, 2);
});

test("一括用の名前確認はPDFも編集本文も取得せず、新規・既存を判定する", async () => {
  const f = await verified(); const saved = await save(f); f.calls.length = 0;
  assert.equal((await f.client.findSaveTargetByTitle("account_A", root.id, backup.name))!.note.id, saved.id);
  assert.equal(await f.client.findSaveTargetByTitle("account_A", root.id, "未保存のノート"), null);
  assert.ok(f.calls.every(({ url, init }) => init.method === "GET" && url.pathname === "/drive/v3/files" && !url.searchParams.has("alt")));
  f.calls.length = 0;
  await assert.rejects(f.client.findSaveTargetByTitle("account_A", root.id, ""), /不正/);
  await assert.rejects(f.client.findSaveTargetByTitle("account_A", root.id, "bad\nname"), /不正/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.client.findSaveTargetByTitle("other-account", root.id, backup.name), /接続確認/);
});

test("PDF照合中に閉じた古い保存は再開せず、認可を維持して次の明示操作だけ実行できる", async () => {
  const f = await verified();
  const saved = await save(f);
  const target = await f.client.findSaveTarget("account_A", root.id, backup);
  let resume!: (buffer: ArrayBuffer) => void;
  let entered!: () => void;
  const comparing = new Promise<void>((done) => { entered = done; });
  class SlowBlob extends Blob {
    override arrayBuffer(): Promise<ArrayBuffer> {
      entered(); return new Promise((done) => { resume = done; });
    }
  }
  const pending = f.client.saveConfirmedNote("account_A", root.id, { ...backup, notes: [{ ...backup.notes[0], pdf: new SlowBlob([backup.notes[0].pdf]) }] }, target);
  await comparing;
  f.client.cancelPending();
  const count = f.calls.length;
  resume(await backup.notes[0].pdf.arrayBuffer());
  await assert.rejects(pending, /キャンセル/);
  assert.equal(f.calls.length, count);
  assert.equal((await list(f)).notes[0].id, saved.id);
});

test("上書き中の失効・応答消失では自動再送せず、結果不明時は一覧から確認できる", async () => {
  for (const status of [401, "lost"] as const) {
    const f = await verified(); const saved = await save(f);
    const target = await f.client.findSaveTarget("account_A", root.id, backup);
    const old = f.files.get(saved.id)!.data;
    let patches = 0;
    f.intercept(async ({ init }) => {
      if (init.method === "PATCH") {
        patches++;
        if (status === 401) return Response.json({}, { status: 401 });
        // サーバー側の更新後に応答が失われた状況。
        f.files.get(saved.id)!.data = init.body as Blob;
        throw new Error("network failure");
      }
      return undefined;
    });
    await assert.rejects(f.client.saveConfirmedNote("account_A", root.id, backup, target), status === 401 ? /再接続/ : /送信結果/);
    assert.equal(patches, 1);
    if (status === 401) {
      assert.equal(f.files.get(saved.id)!.data, old);
      await assert.rejects(list(f), /再接続/);
    } else assert.equal((await list(f)).notes.length, 1);
  }
});

test("大きいJSON更新の再開URLが別ファイルなら本文も認証情報も送らない", async () => {
  const f = await verified(); await save(f);
  const target = await f.client.findSaveTarget("account_A", root.id, backup);
  const large: NoteBackup = { ...backup, notes: [{ ...backup.notes[0], strokesByPage: {
    1: [{ width: 2, points: Array.from({ length: 70_000 }, (_, index) => ({ x: index / 70_000, y: 0.5 })) }],
  } }] };
  f.calls.length = 0;
  f.intercept(async ({ init }) => init.method === "PATCH" ? new Response(null, {
    headers: { Location: "https://www.googleapis.com/upload/drive/v3/files/other_file?upload_id=other" },
  }) : undefined);
  await assert.rejects(f.client.saveConfirmedNote("account_A", root.id, large, target), /応答を確認/);
  assert.equal(f.calls.filter(({ init }) => init.method === "PUT").length, 0);
});

test("1MiBを超える編集JSONは従来の2段階送信を使い、読み戻せる", async () => {
  const f = await verified();
  const large: NoteBackup = { ...backup, notes: [{ ...backup.notes[0], strokesByPage: {
    1: [{ width: 2, points: Array.from({ length: 70_000 }, (_, index) => ({ x: index / 70_000, y: 0.5 })) }],
  } }] };
  f.calls.length = 0;
  const saved = await save(f, large);
  assert.equal(f.calls.length, 6);
  assert.equal(f.calls.filter(({ url }) => url.searchParams.get("uploadType") === "multipart").length, 0);
  const loaded = await f.client.loadNote("account_A", root.id, saved.id);
  assert.deepEqual(loaded.notes[0].strokesByPage, large.notes[0].strokesByPage);
});

test("一括JSON送信の失効・アカウント変更・通信失敗で成功扱いや自動再送をしない", async () => {
  for (const failure of ["unauthorized", "changed", "network"] as const) {
    const f = await verified();
    f.intercept(async ({ url }) => {
      if (url.searchParams.get("uploadType") !== "multipart") return undefined;
      if (failure === "unauthorized") return Response.json({}, { status: 401 });
      if (failure === "changed") { f.changeToken("token_B"); return Response.json({}); }
      throw new Error("private-token");
    });
    await assert.rejects(save(f));
    assert.equal(f.calls.filter(({ url }) => url.searchParams.get("uploadType") === "multipart").length, 1);
    assert.equal([...f.files.values()].filter((file) => file.appProperties.overlayRole === "note").length, 0);
  }
});

test("再開用URLの送信先がGoogle以外・認証情報入り・別パスならトークンやPDFを送らない", async () => {
  for (const location of ["https://evil.example/upload?upload_id=abc", "https://user:password@www.googleapis.com/upload/drive/v3/files?upload_id=abc",
    "https://www.googleapis.com/drive/v3/files?upload_id=abc", "https://www.googleapis.com/upload/drive/v3/files"]) {
    const f = await verified();
    f.intercept(async ({ url, init }) => url.pathname.startsWith("/upload/") && init.method === "POST"
      ? new Response(null, { headers: { Location: location } }) : undefined);
    await assert.rejects(save(f));
    assert.equal(f.calls.filter(({ init }) => init.method === "PUT").length, 0);
  }
});

test("アップロードの開始後にアカウントが変わったら、PDFを送信せず停止する", async () => {
  const f = await verified();
  f.intercept(async ({ url, init }) => {
    if (url.pathname.startsWith("/upload/") && init.method === "POST") {
      f.changeToken("token_B");
      return new Response(null, { headers: { Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=abc" } });
    }
    return undefined;
  });
  await assert.rejects(save(f), /変更/);
  assert.equal(f.calls.filter(({ init }) => init.method === "PUT").length, 0);
});

test("専用フォルダの変更や別アカウントの指定では新規保存を始めない", async () => {
  const f = await verified();
  await assert.rejects(f.client.saveNewNote("account_B", root.id, backup), /接続確認/);
  await assert.rejects(f.client.saveNewNote("account_A", "different_root", backup), /専用フォルダ/);
  assert.ok(f.calls.every(({ init }) => init.method === "GET"));
});

test("他人のノート・別の保存場所・目印のないファイルは本文取得前に拒否する", async () => {
  for (const mutation of ["owner", "root", "role", "parent"] as const) {
    const f = await verified(); const saved = await save(f);
    const file = f.files.get(saved.id)!;
    if (mutation === "owner") file.ownedByMe = false;
    if (mutation === "root") file.appProperties.overlayRootId = "another_root";
    if (mutation === "role") file.appProperties.overlayRole = "other";
    if (mutation === "parent") f.files.get(saved.containerId)!.parents = ["another_root"];
    f.calls.length = 0;
    await assert.rejects(f.client.loadNote("account_A", root.id, saved.id));
    assert.equal(f.calls.filter(({ url }) => url.searchParams.get("alt") === "media").length, 0);
  }
});

test("JSONの版・ノートID・注釈・外部URLのPDF参照を検証し、不正ならPDFを取得しない", async () => {
  for (const mutation of ["version", "key", "strokes", "url"] as const) {
    const f = await verified(); const saved = await save(f); const file = f.files.get(saved.id)!;
    const manifest = JSON.parse(await file.data!.text());
    if (mutation === "version") manifest.schemaVersion = 99;
    if (mutation === "key") manifest.noteKey = "another_note";
    if (mutation === "strokes") manifest.strokesByPage = { 1: [{ points: "bad", width: 1 }] };
    if (mutation === "url") manifest.pdfId = "https://evil.example/private";
    file.data = new Blob([JSON.stringify(manifest)]); file.size = String(file.data.size); f.calls.length = 0;
    await assert.rejects(f.client.loadNote("account_A", root.id, saved.id));
    assert.equal(f.calls.filter(({ url }) => url.searchParams.get("alt") === "media").length, 1);
  }
});

test("JSON本文の実サイズやPDF参照・データ不一致ではコピーを返さない", async () => {
  for (const mutation of ["json-size", "pdf-size", "pdf-parent", "pdf-data"] as const) {
    const f = await verified(); const saved = await save(f);
    const json = f.files.get(saved.id)!;
    const pdf = [...f.files.values()].find((file) => file.appProperties.overlayRole === "pdf")!;
    if (mutation === "json-size") json.size = String(Number(json.size) + 1);
    if (mutation === "pdf-size") pdf.size = "123";
    if (mutation === "pdf-parent") pdf.parents = ["another_folder"];
    if (mutation === "pdf-data") pdf.data = new Blob(["x".repeat(pdf.data!.size)]);
    await assert.rejects(f.client.loadNote("account_A", root.id, saved.id));
  }
});

test("一覧の続きは明示ページ単位で取得し、検索未完了・巨大な続きトークンを拒否する", async () => {
  const calls: Record<string, string>[] = [];
  const access = { async json(_path: string, parameters: Record<string, string>) { calls.push(parameters); return { files: [], nextPageToken: "next" }; },
    upload: async () => ({}), download: async () => new Blob() };
  assert.equal((await listDriveNotes(access, root.id)).nextPageToken, "next");
  await listDriveNotes(access, root.id, "next");
  assert.equal(calls[1].pageToken, "next");
  await assert.rejects(listDriveNotes(access, root.id, "x".repeat(4097)));
  await assert.rejects(listDriveNotes({ ...access, json: async () => ({ files: [], incompleteSearch: true }) }, root.id), /検索しきれ/);
  assert.equal(calls.length, 2);
});

test("認証の失効・対象消失は再接続や更新を案内し、自動で別の保存先へ切り替えない", async () => {
  const f = await verified(); const saved = await save(f);
  f.files.delete(saved.id);
  await assert.rejects(f.client.loadNote("account_A", root.id, saved.id), /一覧を更新/);
  f.changeToken(null);
  await assert.rejects(list(f), /再接続/);
});

test("読み込み上限を超えるJSONをヘッダーまたは受信中に止める", async () => {
  for (const header of [true, false]) {
    const f = await verified(); const saved = await save(f);
    f.intercept(async ({ url }) => {
      if (url.searchParams.get("alt") !== "media") return undefined;
      const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1)); controller.close(); } });
      return new Response(stream, header ? { headers: { "Content-Length": String(16 * 1024 * 1024 + 1) } } : {});
    });
    await assert.rejects(f.client.loadNote("account_A", root.id, saved.id));
  }
});

test("新しい接続からもDriveの一覧・本文を取得でき、ローカルIDや送信元の状態に依存しない", async () => {
  const f = await verified(); const saved = await save(f);
  const next = f.newClient();
  await next.getAccount();
  const page = await next.listNotes("account_A", root.id);
  assert.equal(page.notes[0].id, saved.id);
  const loaded = await next.loadNote("account_A", root.id, saved.id);
  assert.deepEqual(loaded.notes[0].strokesByPage, backup.notes[0].strokesByPage);
  assert.notEqual(loaded.notes[0].id, backup.notes[0].id);
});

test("送信中の閉鎖で通信を中断し、遅れて返ったPDF応答からJSON保存へ進まない", async () => {
  const f = await verified();
  let release!: (response: Response) => void;
  let entered!: () => void;
  const sending = new Promise<void>((resolve) => { entered = resolve; });
  f.intercept(async ({ init }) => {
    if (init.method !== "PUT") return undefined;
    entered();
    return new Promise<Response>((resolve) => { release = resolve; });
  });
  const pending = save(f);
  await sending;
  const signal = f.calls.at(-1)!.init.signal!;
  f.client.dispose(); assert.equal(signal.aborted, true);
  release(Response.json({}));
  await assert.rejects(pending, /キャンセル/);
  assert.equal(f.calls.filter(({ url, init }) => url.pathname.startsWith("/upload/") && init.method === "POST").length, 1);
});
