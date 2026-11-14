import { saveDriveImages } from "./driveImages";
import type { DriveBinding } from "./driveOutbox";
import { DriveHttpError } from "./driveHttpError";
import type { DriveNoteAccess } from "./googleDriveNotes";
import { DRIVE_NOTE_FIELDS, DRIVE_NOTE_SUFFIX, driveFile, driveId, driveNoteSummary, driveObject, readDriveManifest, singleDriveNote,
  type DriveNoteManifest } from "./googleDriveNoteData";
import { BACKUP_LIMITS, type NoteBackup } from "./noteBackupData";

export async function sha256(blob: Blob) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function reserveDriveIds(access: DriveNoteAccess): Promise<NonNullable<DriveBinding["ids"]>> {
  const value = driveObject(await access.json("files/generateIds", { count: "3", space: "drive", type: "files", fields: "ids" }));
  if (!Array.isArray(value.ids) || value.ids.length !== 3 || new Set(value.ids).size !== 3) throw new Error("Driveの保存先IDを準備できませんでした。");
  return { container: driveId(value.ids[0]), pdf: driveId(value.ids[1]), note: driveId(value.ids[2]) };
}

async function metadata(access: DriveNoteAccess, id: string) {
  try { return await access.json(`files/${driveId(id)}`, { fields: DRIVE_NOTE_FIELDS }); }
  catch (error) { if (error instanceof DriveHttpError && error.status === 404) return null; throw error; }
}

// 予約済みIDだけを使う。応答不明後の再送で409になったら、そのIDの実体を検証する。
async function createOnce(access: DriveNoteAccess, id: string, create: () => Promise<unknown>) {
  try { return await create(); }
  catch (error) {
    if (!(error instanceof DriveHttpError) || error.status !== 409) throw error;
    const saved = await metadata(access, id);
    if (!saved) throw new Error("Driveの作成結果を確認できませんでした。");
    return saved;
  }
}

export function driveManifestContent(manifest: DriveNoteManifest) {
  // 項目順も固定し、検証後に同じハッシュを再計算できるようにする。
  return { kind: "overlay-drive-note", noteKey: manifest.noteKey, title: manifest.title, fileName: manifest.fileName,
    pdfId: manifest.pdfId, pdfBytes: manifest.pdfBytes, strokesByPage: manifest.strokesByPage, textsByPage: manifest.textsByPage,
    ...(manifest.tapesByPage ? { tapesByPage: manifest.tapesByPage } : {}), ...(manifest.images ? { images: manifest.images } : {}), ...(manifest.pages ? { pages: manifest.pages } : {}), ...(manifest.headingsByPage ? { headingsByPage: manifest.headingsByPage } : {}) };
}

export async function sendDriveAutosave(access: DriveNoteAccess, binding: DriveBinding & { pdfHash: string }, backup: NoteBackup) {
  if (!binding.ids || !access.replace) throw new Error("Drive自動保存の準備が完了していません。");
  const { container, pdf, note: noteId } = binding.ids;
  const source = singleDriveNote(backup);
  if (!((await source.pdf.slice(0, 1024).text()).includes("%PDF-"))) throw new Error("保存するPDFの形式が不正です。");
  if (new Blob([JSON.stringify({ tapes: source.tapesByPage, strokes: source.strokesByPage, texts: source.textsByPage, pages: source.pages, headings: source.headingsByPage })]).size > BACKUP_LIMITS.jsonBytes - 4096) {
    throw new Error("編集情報が16MiBを超えたため、Drive自動保存を停止しました。");
  }
  const properties = (role: string) => ({ overlayApp: "overlay", overlaySchema: "1", overlayRole: role,
    overlayRootId: binding.rootId, overlayNoteKey: binding.key, overlayDeviceId: binding.deviceId });
  const parentId = binding.parentId ?? binding.rootId;
  // 保存済みの親IDから読み取りを先行する。下のdriveFileで実際のコンテナの親とも照合し、
  // 階層確認が成功するまでは作成・更新しない。ローカル階層だけでDriveの現状を信頼しない。
  const ancestry = parentId === binding.rootId ? Promise.resolve()
    : import("./driveLibraryRemote").then(({ verifyLibraryAncestry }) => verifyLibraryAncestry(access, { parents: [parentId] }, binding.rootId));
  const [folderMetadata, pdfMetadata, noteMetadata] = await Promise.all([
    metadata(access, container), metadata(access, pdf), metadata(access, noteId), ancestry,
  ]);
  if (binding.uploadedGeneration > 0 && (!folderMetadata || !pdfMetadata || !noteMetadata)) {
    throw new Error("保存済みのDriveファイルが見つかりません。作り直さず停止しました。端末の内容は残っています。");
  }
  const folder = folderMetadata ?? await createOnce(access, container, () => access.json("files", { fields: DRIVE_NOTE_FIELDS }, {
    id: container, name: `${source.title} (${binding.deviceId.slice(0, 8)})`, mimeType: "application/vnd.google-apps.folder",
    parents: [parentId], appProperties: properties("note-container"),
  }));
  if (driveFile(folder, "note-container", binding.rootId, binding.key, parentId).id !== container) throw new Error("Driveの保存先が一致しません。");
  const original = driveFile(pdfMetadata ?? await createOnce(access, pdf, () => access.upload({ id: pdf,
    name: source.fileName, mimeType: "application/pdf", parents: [container], appProperties: properties("pdf") }, source.pdf)),
  "pdf", binding.rootId, binding.key, container);
  if (original.id !== pdf || Number(original.size) !== source.pdf.size || typeof original.sha256Checksum !== "string" || original.sha256Checksum.toLowerCase() !== binding.pdfHash) {
    throw new Error("Driveの元PDFが変更されています。自動保存を停止しました。端末の内容は残っています。");
  }
  const images = await saveDriveImages(access, binding.rootId, binding.key, container, source.images);
  const draft: DriveNoteManifest = { schemaVersion: source.tapesByPage ? 6 : images ? 5 : 4, ...(source.tapesByPage ? { tapesByPage: source.tapesByPage } : {}), ...(images ? { images } : {}), kind: "overlay-drive-note", noteKey: binding.key,
    title: source.title, fileName: source.fileName, pdfId: pdf, pdfBytes: source.pdf.size,
    strokesByPage: source.strokesByPage, textsByPage: source.textsByPage,
    ...(source.pages ? { pages: source.pages } : {}), ...(source.headingsByPage ? { headingsByPage: source.headingsByPage } : {}) };
  const hash = await sha256(new Blob([JSON.stringify(driveManifestContent(draft))]));
  const manifest = { ...draft, sync: { deviceId: binding.deviceId, generation: binding.generation, hash } };
  const data = new Blob([JSON.stringify(manifest)], { type: "application/json" });
  if (data.size > BACKUP_LIMITS.jsonBytes) throw new Error("編集情報が16MiBを超えたため、Drive自動保存を停止しました。");
  const checksum = await sha256(data);

  async function checkExisting(value: unknown): Promise<{ current: false } | { current: true; checksum: string; bytes: number }> {
    const file = driveFile(value, "sync-note", binding.rootId, binding.key, container);
    const size = Number(file.size);
    if (file.id !== noteId || driveObject(file.appProperties).overlayDeviceId !== binding.deviceId
      || !Number.isSafeInteger(size) || size > BACKUP_LIMITS.jsonBytes || size <= 0) throw new Error("自動保存先の端末情報・サイズが一致しません。");
    // 本文を持たないメタデータだけで、検証済みの同一バイト列だと確認できる場合に限って省略する。
    const remoteChecksum = typeof file.sha256Checksum === "string" ? file.sha256Checksum.toLowerCase() : undefined;
    if (remoteChecksum === checksum && size === data.size) return { current: true, checksum, bytes: size };
    if (binding.uploadedGeneration > 0 && binding.uploadedHash && /^[a-f0-9]{64}$/.test(binding.uploadedChecksum ?? "")
      && remoteChecksum === binding.uploadedChecksum && size === binding.uploadedJsonBytes) return { current: false };
    // チェックサム未提供・旧保存情報・未知の本文は、従来どおり取得して世代と内容を検証する。
    const downloaded = await access.download(noteId, BACKUP_LIMITS.jsonBytes);
    if (downloaded.size !== Number(file.size)) throw new Error("Driveノートの取得中に内容が変わりました。");
    let raw: unknown;
    try { raw = JSON.parse(await downloaded.text()); }
    catch { throw new Error("Driveの編集情報を読み取れませんでした。自動保存を停止しました。"); }
    const saved = readDriveManifest(raw, binding.key);
    const sync = saved.sync;
    if (!sync || sync.deviceId !== binding.deviceId || saved.pdfId !== pdf || saved.pdfBytes !== source.pdf.size
      || sync.hash !== await sha256(new Blob([JSON.stringify(driveManifestContent(saved))]))
      || sync.generation > binding.generation || sync.generation < binding.uploadedGeneration
      || (sync.generation === binding.uploadedGeneration && binding.uploadedHash !== undefined && sync.hash !== binding.uploadedHash)
      || (sync.generation === binding.generation && sync.hash !== hash)) {
      throw new Error("Driveの保存内容に競合があります。自動保存を停止し、両方の内容を残しました。");
    }
    return sync.generation === binding.generation && sync.hash === hash
      ? { current: true, checksum: await sha256(downloaded), bytes: downloaded.size } : { current: false };
  }
  const existing = noteMetadata;
  if (existing) {
    const checked = await checkExisting(existing);
    if (checked.current) return { hash, checksum: checked.checksum, bytes: checked.bytes, version: String(driveObject(existing).version) }; // 応答消失後も同じ内容を再送しない。
  }
  const saved = existing ? await access.replace(noteId, data, { name: `${source.title}${DRIVE_NOTE_SUFFIX}` })
    : await createOnce(access, noteId, () => access.upload({ id: noteId, name: `${source.title}${DRIVE_NOTE_SUFFIX}`,
      mimeType: "application/json", parents: [container], appProperties: properties("sync-note") }, data));
  const summary = driveNoteSummary(saved, binding.rootId);
  if (summary.id !== noteId || summary.noteKey !== binding.key || summary.deviceId !== binding.deviceId || summary.containerId !== container) {
    throw new Error("Drive自動保存の結果を確認できませんでした。");
  }
  // アップロード応答だけを信用せず、更新後の実体を再確認する。通常は小さいメタデータだけで済む。
  const latest = await metadata(access, noteId);
  if (!latest) throw new Error("Drive自動保存の結果を確認できませんでした。");
  const checked = await checkExisting(latest);
  if (!checked.current) throw new Error("Drive自動保存の結果を確認できませんでした。");
  return { hash, checksum: checked.checksum, bytes: checked.bytes, version: String(driveObject(latest).version) };
}
