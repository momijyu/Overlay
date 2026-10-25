import assert from "node:assert/strict";
import test, { beforeEach, afterEach, mock } from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { PDFDocument } from "pdf-lib";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { readFileSync } from "node:fs";
import { backupDownloadName, BACKUP_LIMITS, readNoteBackup, type NoteBackup } from "@/features/pdf-editor/noteBackupData";
import { encodeNoteBackup, decodeNoteBackup } from "@/features/pdf-editor/noteBackupFile";
import { captureNoteBackup, captureSelectedNoteBackup, restoreNoteBackup, createNoteFolder, loadNoteLibrary, loadLocalNote,
  saveLocalNote, moveSavedNote, organizeNote } from "@/features/pdf-editor/localNotes";
import { readRequest, withLocalTransaction } from "@/features/pdf-editor/localDatabase";
import { exportAnnotatedPdf } from "@/features/pdf-editor/exportAnnotatedPdf";
import { createLocalAutosave } from "@/features/pdf-editor/localAutosave";
import { eraseStrokes } from "@/features/pdf-editor/eraseStrokes";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { libraryItems } from "@/features/pdf-editor/noteDrag";

const pdf = await PDFDocument.create();
pdf.addPage([600, 800]); pdf.addPage([600, 800]);
const pdfBytes = await pdf.save();
const file = new File([new Uint8Array(pdfBytes)], "講義.pdf", { type: "application/pdf" });
function fixture(): NoteBackup {
  return { schemaVersion: 1, kind: "note", name: "復習ノート", folders: [], notes: [{
    id: "source", title: "復習ノート", fileName: file.name, folderId: null, pdf: file,
    strokesByPage: { 1: [{ width: 2.5, color: "#ff0000", points: [{ x: 0.1, y: 0.3 }] }],
      2: [{ width: 20, kind: "marker", color: "#ffff00", points: [{ x: 0.4, y: 0.8 }, { x: 0.5, y: 0.8 }] }] },
    textsByPage: { 2: [{ id: "text", kind: "text", text: "試験\n重要", x: 0.1, y: 0.1, width: 0.5, fontSize: 16, color: "#ff0000", autoSize: true },
      { id: "sticky", kind: "sticky", text: "見直す", x: 0.2, y: 0.4, width: 0.5, fontSize: 20, backgroundColor: "#ffeeaa" }] },
  }] };
}
beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
  mock.method(globalThis, "fetch", () => { throw new Error("バックアップで外部送信しない"); });
});
afterEach(() => mock.restoreAll());

// 実装と別の単純なCRC計算で、破損以外の入力検証も試せるようにする。
function crc(bytes: Uint8Array) {
  let result = -1;
  for (const byte of bytes) {
    result ^= byte;
    for (let i = 0; i < 8; i++) result = (result >>> 1) ^ ((result & 1) ? 0xedb88320 : 0);
  }
  return ((result ^ -1) >>> 0).toString(16).padStart(8, "0");
}
async function rewrite(file: Blob, change: (data: ReturnType<typeof unzipSync>) => void) {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  change(entries);
  entries["manifest.crc"] = strToU8(crc(entries["manifest.json"]));
  return new Blob([zipSync(entries, { level: 0 })]);
}
async function counts() {
  return withLocalTransaction(["notes", "pdfs", "folders"], "readonly", async (tx) => Promise.all(
    ["notes", "pdfs", "folders"].map((name) => readRequest(tx.objectStore(name).count())),
  ));
}

test("単体バックアップは元PDF・全ページの線・マーカー・日本語・色・サイズを無損失で復元する", async () => {
  const original = fixture();
  const encoded = await encodeNoteBackup(original);
  const decoded = await decodeNoteBackup(encoded);
  assert.deepEqual({ ...decoded.notes[0], pdf: null }, { ...original.notes[0], pdf: null });
  assert.deepEqual(new Uint8Array(await decoded.notes[0].pdf.arrayBuffer()), pdfBytes);
  assert.equal(decoded.kind, "note");
  assert.equal(decoded.schemaVersion, 1);
  assert.deepEqual(await counts(), [0, 0, 0]); // 書き出しと解析だけではDBへ追加しない。
});

test("単体は所属を持ち出さず新しいIDで復元し、同名ノートを上書きせず再編集・再保存できる", async () => {
  const original = fixture().notes[0];
  const id = await saveLocalNote({ file, noteId: null, strokesByPage: original.strokesByPage, textsByPage: original.textsByPage });
  const folder = await createNoteFolder("講義", null);
  await organizeNote(id, original.title, folder);
  const before = await loadLocalNote(id);
  const backup = await captureNoteBackup({ kind: "note", id });
  assert.deepEqual(backup.folders, []);
  assert.equal(backup.notes[0].folderId, null);
  const parsed = await decodeNoteBackup(await encodeNoteBackup(backup));
  await restoreNoteBackup(parsed);
  const restored = (await loadNoteLibrary()).notes.find((note) => note.id !== id)!;
  assert.equal(restored.title, original.title);
  assert.equal(restored.folderId, null);
  const loaded = await loadLocalNote(restored.id);
  assert.deepEqual(loaded.textsByPage, original.textsByPage);
  assert.equal(loaded.revision, 1);
  await saveLocalNote({ ...loaded, noteId: loaded.id, expectedRevision: 1, strokesByPage: {}, textsByPage: {} });
  assert.deepEqual((await loadLocalNote(restored.id)).strokesByPage, {});
  const unchanged = await loadLocalNote(id);
  assert.deepEqual({ ...unchanged, file: null }, { ...before, file: null });
  assert.deepEqual(await unchanged.file.arrayBuffer(), await before.file.arrayBuffer());
  assert.deepEqual(await counts(), [2, 2, 1]);
});

test("フォルダは子孫と空フォルダを含み、外側を含めず階層をコピーし、同名の根には復元名を付ける", async () => {
  const outside = await createNoteFolder("外側", null);
  const root = await createNoteFolder("2026", outside);
  const child = await createNoteFolder("情報", root);
  await createNoteFolder("空", child);
  const note = await saveLocalNote({ file, noteId: null, strokesByPage: fixture().notes[0].strokesByPage });
  await moveSavedNote(note, child);
  await createNoteFolder("2026", null);
  const before = await loadNoteLibrary();
  const backup = await captureNoteBackup({ kind: "folder", id: root });
  assert.equal(backup.folders.length, 3);
  assert.equal(backup.folders.find((item) => item.id === root)?.parentId, null);
  const parsed = await decodeNoteBackup(await encodeNoteBackup(backup));
  assert.deepEqual(await restoreNoteBackup(parsed), { notes: 1, folders: 3 });
  await restoreNoteBackup(parsed);
  const library = await loadNoteLibrary();
  const copied = library.folders.find((item) => item.name === "2026（復元1）")!;
  const copiedChild = library.folders.find((item) => item.parentId === copied.id)!;
  assert.equal(copiedChild.name, "情報");
  assert.equal(library.folders.find((item) => item.parentId === copiedChild.id)?.name, "空");
  assert.equal(library.notes.find((item) => item.folderId === copiedChild.id)?.fileName, file.name);
  assert.ok(library.folders.some((item) => item.name === "2026（復元2）"));
  for (const folder of before.folders) assert.deepEqual(library.folders.find((item) => item.id === folder.id), folder);
});

test("空フォルダだけのバックアップも往復し、PDFなしで復元できる", async () => {
  const id = await createNoteFolder("空", null);
  const backup = await decodeNoteBackup(await encodeNoteBackup(await captureNoteBackup({ kind: "folder", id })));
  assert.deepEqual(await restoreNoteBackup(backup), { notes: 0, folders: 1 });
  assert.deepEqual(await counts(), [0, 0, 2]);
});

test("複数選択したノートだけをZIPへまとめ、同名・別フォルダでも重複せず復元する", async () => {
  const folder = await createNoteFolder("講義", null);
  const first = await saveLocalNote({ file, noteId: null, strokesByPage: fixture().notes[0].strokesByPage });
  const second = await saveLocalNote({ file, noteId: null, strokesByPage: {}, textsByPage: fixture().notes[0].textsByPage });
  const excluded = await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  await moveSavedNote(first, folder);
  const backup = await captureSelectedNoteBackup([{ kind: "note", id: first }, { kind: "note", id: second }, { kind: "note", id: first }]);
  assert.equal(backup.schemaVersion, 2);
  assert.equal(backup.kind, "selection");
  assert.equal(backup.notes.length, 2);
  assert.equal(backup.folders.length, 0);
  assert.ok(backup.notes.every((note) => note.folderId === null && note.id !== excluded));
  const zip = new File([await encodeNoteBackup(backup)], backupDownloadName(backup.name, "zip"), { type: "application/zip" });
  assert.ok(zip.name.endsWith(".zip"));
  assert.equal(unzipSync(new Uint8Array(await zip.arrayBuffer()))["pdfs/1.pdf"].length, pdfBytes.length);
  const parsed = await decodeNoteBackup(zip);
  assert.deepEqual(await restoreNoteBackup(parsed), { notes: 2, folders: 0 });
  assert.deepEqual(await counts(), [5, 5, 1]);
});

test("選択した親子と別ノートを1つのZIPにまとめ、階層・空フォルダを保ち外側を含めない", async () => {
  const parent = await createNoteFolder("親", null);
  const child = await createNoteFolder("子", parent);
  await createNoteFolder("空", child);
  const inside = await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  const outside = await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  const keep = await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  await moveSavedNote(inside, child);
  const selected = libraryItems(await loadNoteLibrary()).filter((item) => item.id !== keep);
  const backup = await captureSelectedNoteBackup(selected);
  assert.equal(backup.folders.length, 3);
  assert.equal(backup.notes.length, 2);
  assert.equal(backup.notes.find((note) => note.id === inside)?.folderId, child);
  assert.equal(backup.notes.find((note) => note.id === outside)?.folderId, null);
  const parsed = await decodeNoteBackup(await encodeNoteBackup(backup));
  assert.deepEqual(await restoreNoteBackup(parsed), { notes: 2, folders: 3 });
});

test("別の親にある同名フォルダを選択でき、復元時はZIP内の同名の根同士も衝突させない", async () => {
  const firstParent = await createNoteFolder("A", null);
  const secondParent = await createNoteFolder("B", null);
  const first = await createNoteFolder("情報", firstParent);
  const second = await createNoteFolder("情報", secondParent);
  const backup = await captureSelectedNoteBackup([{ kind: "folder", id: first }, { kind: "folder", id: second }]);
  assert.deepEqual(backup.folders.map((folder) => folder.name), ["情報", "情報"]);
  const parsed = await decodeNoteBackup(await encodeNoteBackup(backup));
  await restoreNoteBackup(parsed);
  const roots = (await loadNoteLibrary()).folders.filter((folder) => folder.parentId === null);
  assert.ok(roots.some((folder) => folder.name === "情報"));
  assert.ok(roots.some((folder) => folder.name === "情報（復元1）"));
});

test("選択後に増えた未選択の子・消えた対象・空選択を拒否し、未チェックを暗黙に追加しない", async () => {
  const parent = await createNoteFolder("親", null);
  const selected = [{ kind: "folder" as const, id: parent }];
  await createNoteFolder("後で追加", parent);
  await assert.rejects(captureSelectedNoteBackup(selected), /中身が変わりました/);
  await assert.rejects(captureSelectedNoteBackup([]), /対象が見つかりません/);
  await assert.rejects(captureSelectedNoteBackup([{ kind: "note", id: "missing" }]), /対象が見つかりません/);
  assert.deepEqual(await counts(), [0, 0, 2]);
  assert.throws(() => readNoteBackup({ schemaVersion: 2, kind: "selection", name: "空", folders: [], notes: [] }));
  assert.throws(() => readNoteBackup({ ...fixture(), kind: "selection" })); // 新形式は旧版と区別する。
});

test("復元したノートを部分消去・自動保存・再読み込みし、日本語入りPDFを書き出せる", async () => {
  await restoreNoteBackup(await decodeNoteBackup(await encodeNoteBackup(fixture())));
  const id = (await loadNoteLibrary()).notes[0].id;
  const loaded = await loadLocalNote(id);
  const strokes = { ...loaded.strokesByPage,
    2: eraseStrokes(loaded.strokesByPage[2], { x: 0.45, y: 0.8 }, { x: 0.45, y: 0.8 }, 600, 800, 10, 1) };
  const autosave = createLocalAutosave({ file: loaded.file, noteId: id, revision: loaded.revision,
    strokesByPage: loaded.strokesByPage, textsByPage: loaded.textsByPage, persist: saveLocalNote, onChange: () => {} });
  autosave.update(strokes, loaded.textsByPage!);
  assert.equal(await autosave.flush(), true);
  autosave.dispose();
  const reopened = await loadLocalNote(id);
  assert.deepEqual(reopened.strokesByPage, strokes);
  const fontBytes = readFileSync(new URL("../public/fonts/NotoSansJP-Regular.otf", import.meta.url));
  mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => {
    assert.equal(url, "/fonts/NotoSansJP-Regular.otf");
    return new Response(fontBytes);
  });
  const displayed = await getDocument({ data: new Uint8Array(await reopened.file.arrayBuffer()), disableFontFace: true }).promise;
  try {
    const output = await exportAnnotatedPdf(reopened.file, displayed, reopened.strokesByPage, reopened.textsByPage);
    const parsed = await getDocument({ data: output.slice(), disableFontFace: true }).promise;
    try {
      assert.equal(parsed.numPages, 2);
      const content = await (await parsed.getPage(2)).getTextContent();
      const text = content.items.flatMap((item) => "str" in item ? [item.str] : []).join("");
      for (const expected of ["試験", "重要", "見直す"]) assert.ok(text.includes(expected));
    } finally { await parsed.loadingTask.destroy(); }
  } finally { await displayed.loadingTask.destroy(); }
});

test("復元途中の容量不足では先行したフォルダ・ノート・PDFも全件取り消す", async () => {
  await restoreNoteBackup(fixture());
  const folder = await createNoteFolder("残す", null);
  const before = await loadNoteLibrary();
  const backup: NoteBackup = { ...fixture(), kind: "folder", folders: [{ id: "root", name: "追加", parentId: null }],
    notes: [{ ...fixture().notes[0], folderId: "root" }, { ...fixture().notes[0], id: "second", folderId: "root" }] };
  const original = IDBObjectStore.prototype.add;
  let calls = 0;
  const stub = mock.method(IDBObjectStore.prototype, "add", function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
    if (this.name === "notes" && ++calls === 2) throw new DOMException("容量不足", "QuotaExceededError");
    return original.apply(this, args);
  });
  await assert.rejects(restoreNoteBackup(backup), /保存容量が不足/);
  stub.mock.restore();
  assert.deepEqual(await loadNoteLibrary(), before);
  assert.deepEqual(await counts(), [1, 1, 1]);
  assert.equal(before.folders[0].id, folder);
});

test("旧ノートの文章なしも書き出せ、対象や元PDFの欠落では不完全なバックアップを作らない", async () => {
  const note = await saveLocalNote({ file, noteId: null, strokesByPage: {} });
  await withLocalTransaction(["notes"], "readwrite", async (tx) => {
    const record = await readRequest(tx.objectStore("notes").get(note));
    delete record.textsByPage;
    await readRequest(tx.objectStore("notes").put(record));
  });
  assert.deepEqual((await decodeNoteBackup(await encodeNoteBackup(await captureNoteBackup({ kind: "note", id: note })))).notes[0].textsByPage, {});
  await assert.rejects(captureNoteBackup({ kind: "folder", id: "missing" }), /見つかりません/);
  await withLocalTransaction(["pdfs"], "readwrite", async (tx) => { await readRequest(tx.objectStore("pdfs").delete(note)); });
  await assert.rejects(captureNoteBackup({ kind: "note", id: note }), /元PDFが見つかりません/);
});

test("破損・未知の版・余分なパス・不足PDF・圧縮ZIPを拒否し、DBを変更しない", async () => {
  const encoded = await encodeNoteBackup(fixture());
  const cases = [new Blob(["not zip"]), new Blob([]),
    await rewrite(encoded, (entries) => { entries["pdfs/0.pdf"][5] ^= 1; }),
    await rewrite(encoded, (entries) => { entries["../outside"] = strToU8("x"); }),
    await rewrite(encoded, (entries) => { delete entries["pdfs/0.pdf"]; }),
    await rewrite(encoded, (entries) => { const data = JSON.parse(strFromU8(entries["manifest.json"])); data.schemaVersion = 999; entries["manifest.json"] = strToU8(JSON.stringify(data)); }),
    new Blob([zipSync(unzipSync(new Uint8Array(await encoded.arrayBuffer())), { level: 6 })]),
  ];
  for (const input of cases) await assert.rejects(async () => restoreNoteBackup(await decodeNoteBackup(input)));
  const broken = new Uint8Array(await encoded.arrayBuffer());
  broken[50] ^= 1;
  await assert.rejects(decodeNoteBackup(new Blob([broken])));
  assert.deepEqual(await counts(), [0, 0, 0]);
});

test("元PDFの解析失敗と存在しないページへの編集を拒否する", async () => {
  const backup = fixture();
  backup.notes[0].pdf = new Blob(["not pdf"]);
  await assert.rejects(encodeNoteBackup(backup), /元PDF/);
  const other = fixture();
  other.notes[0].textsByPage[3] = other.notes[0].textsByPage[2];
  await assert.rejects(encodeNoteBackup(other), /ページ数/);
  const encoded = await encodeNoteBackup(fixture());
  const invalidPdf = await rewrite(encoded, (entries) => {
    entries["pdfs/0.pdf"] = strToU8("not pdf");
    const data = JSON.parse(strFromU8(entries["manifest.json"]));
    data.notes[0].pdfChecksum = crc(entries["pdfs/0.pdf"]);
    entries["manifest.json"] = strToU8(JSON.stringify(data));
  });
  await assert.rejects(decodeNoteBackup(invalidPdf), /元PDF/);
  const invalidPage = await rewrite(encoded, (entries) => {
    const data = JSON.parse(strFromU8(entries["manifest.json"]));
    data.notes[0].strokesByPage[99] = data.notes[0].strokesByPage[1];
    entries["manifest.json"] = strToU8(JSON.stringify(data));
  });
  await assert.rejects(decodeNoteBackup(invalidPage), /ページ数/);
});

test("公開するfflateライセンスは導入バージョンの全文と一致する", () => {
  const original = readFileSync(new URL("../node_modules/fflate/LICENSE", import.meta.url), "utf8");
  const included = readFileSync(new URL("../public/licenses/fflate-LICENSE.txt", import.meta.url), "utf8");
  assert.equal(included.trim(), original.trim());
});

test("循環・孤立・同名兄弟・重複ID・不正座標・不正文章・件数超過を検証する", () => {
  const folderBackup = { ...fixture(), kind: "folder", notes: [], folders: [{ id: "root", name: "親", parentId: null }] };
  const cases = [
    { ...folderBackup, folders: [{ id: "root", name: "親", parentId: "root" }] },
    { ...folderBackup, folders: [{ id: "root", name: "親", parentId: "missing" }] },
    { ...folderBackup, folders: [...folderBackup.folders, { id: "child", name: "子", parentId: "root" }, { id: "child2", name: "子", parentId: "root" }] },
    { ...folderBackup, folders: [...folderBackup.folders, ...folderBackup.folders] },
    { ...fixture(), notes: [{ ...fixture().notes[0], strokesByPage: { 1: [{ width: 2, points: [{ x: -1, y: 0 }] }] } }] },
    { ...fixture(), notes: [{ ...fixture().notes[0], textsByPage: { 1: [{ text: "" }] } }] },
    { ...fixture(), notes: Array(BACKUP_LIMITS.notes + 1).fill(fixture().notes[0]) },
  ];
  for (const input of cases) assert.throws(() => readNoteBackup(input));
});

test("巨大なファイルをarrayBufferより前に拒否し、出力名の危険な区切りを置き換える", async () => {
  await assert.rejects(decodeNoteBackup({ size: BACKUP_LIMITS.bytes + 1, arrayBuffer: () => { throw new Error("読んではいけない"); } } as unknown as Blob), /256MiB/);
  assert.equal(backupDownloadName("情報/復習:1"), "情報_復習_1.overlay");
  assert.equal(backupDownloadName("資料.overlay"), "資料.overlay");
  assert.equal(backupDownloadName(" "), "ノート.overlay");
});
