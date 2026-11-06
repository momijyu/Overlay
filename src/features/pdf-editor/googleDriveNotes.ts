import { checkPageBindings } from "./notePages";
import { BACKUP_LIMITS, readNoteBackup, type NoteBackup } from "./noteBackupData";
import { DRIVE_NOTE_FIELDS, DRIVE_NOTE_SUFFIX, driveFile, driveId, driveNoteSummary, driveObject,
  readDriveManifest, singleDriveNote, type DriveNoteManifest, type DriveNoteSummary, type DriveOverwriteTarget } from "./googleDriveNoteData";

// 1操作の開始時に確認したアカウントへ固定した窓口。トークンや任意URLを保存データへ含めない。
export type DriveNoteAccess = {
  json(path: string, parameters: Record<string, string>, body?: unknown): Promise<unknown>;
  upload(metadata: Record<string, unknown>, data: Blob): Promise<unknown>;
  download(fileId: string, maximumBytes: number): Promise<Blob>;
  updateMetadata?: (fileId: string, metadata: Record<string, unknown>, parameters?: Record<string, string>) => Promise<unknown>;
  replace?: (fileId: string, data: Blob, metadata?: Record<string, unknown>) => Promise<unknown>;
};

function noteQuery(rootId: string, includeAutosave = false) {
  return "trashed = false and 'me' in owners and mimeType = 'application/json'"
    + " and appProperties has { key='overlayApp' and value='overlay' }"
    + (includeAutosave ? " and (appProperties has { key='overlayRole' and value='note' } or appProperties has { key='overlayRole' and value='sync-note' })"
      : " and appProperties has { key='overlayRole' and value='note' }")
    + ` and appProperties has { key='overlayRootId' and value='${driveId(rootId)}' }`;
}

function version(value: unknown): string {
  if (typeof value !== "string" || !/^\d{1,30}$/.test(value)) throw new Error("Driveノートの更新情報を確認できませんでした。");
  return value;
}

export async function findDriveOverwriteTarget(access: DriveNoteAccess, rootId: string, title: string): Promise<DriveOverwriteTarget | null> {
  const name = `${title}${DRIVE_NOTE_SUFFIX}`.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const result = driveObject(await access.json("files", { q: `${noteQuery(rootId)} and name = '${name}'`,
    spaces: "drive", corpora: "user", pageSize: "2", fields: `files(${DRIVE_NOTE_FIELDS}),nextPageToken,incompleteSearch` }));
  if (!Array.isArray(result.files) || result.incompleteSearch || result.nextPageToken || result.files.length > 1) {
    throw new Error("同名ノートを1件に特定できません。Drive上の名前を整理してから保存してください。");
  }
  if (!result.files.length) return null;
  const note = driveNoteSummary(result.files[0], rootId);
  if (note.title !== title) throw new Error("Driveノート名が一致しません。");
  return { note, version: version(driveObject(result.files[0]).version) };
}

export async function saveNewDriveNote(access: DriveNoteAccess, rootId: string, input: NoteBackup): Promise<DriveNoteSummary> {
  driveId(rootId);
  const note = singleDriveNote(input);
  if (!((await note.pdf.slice(0, 1024).text()).includes("%PDF-"))) throw new Error("保存するPDFの形式が不正です。");
  if (new Blob([JSON.stringify({ headings: note.headingsByPage, pages: note.pages, strokes: note.strokesByPage, texts: note.textsByPage })]).size > BACKUP_LIMITS.jsonBytes - 4096) {
    throw new Error("編集データが大きすぎます。Driveへの新規保存は編集情報16MiB以下のノートに対応しています。");
  }
  const noteKey = crypto.randomUUID();
  const properties = (role: string) => ({ overlayApp: "overlay", overlaySchema: "1", overlayRole: role, overlayRootId: rootId, overlayNoteKey: noteKey });
  const container = driveFile(await access.json("files", { fields: DRIVE_NOTE_FIELDS }, {
    name: note.title, mimeType: "application/vnd.google-apps.folder", parents: [rootId], appProperties: properties("note-container"),
  }), "note-container", rootId, noteKey, rootId);
  const containerId = driveId(container.id);
  const pdf = driveFile(await access.upload({ name: note.fileName, mimeType: "application/pdf", parents: [containerId],
    appProperties: properties("pdf") }, note.pdf), "pdf", rootId, noteKey, containerId);
  if (Number(pdf.size) !== note.pdf.size) throw new Error("Driveへ送信したPDFのサイズを確認できませんでした。");
  const manifest: DriveNoteManifest = { schemaVersion: note.headingsByPage ? 3 : note.pages ? 2 : 1, ...(note.headingsByPage ? { headingsByPage: note.headingsByPage } : {}), ...(note.pages ? { pages: note.pages } : {}), kind: "overlay-drive-note", noteKey, title: note.title,
    fileName: note.fileName, pdfId: driveId(pdf.id), pdfBytes: note.pdf.size, strokesByPage: note.strokesByPage, textsByPage: note.textsByPage };
  // 最後のJSONアップロードが完了したノートだけ一覧へ現れる。途中失敗の元PDF・フォルダを勝手に削除しない。
  const saved = await access.upload({ name: `${note.title}${DRIVE_NOTE_SUFFIX}`, mimeType: "application/json", parents: [containerId],
    appProperties: properties("note") }, new Blob([JSON.stringify(manifest)], { type: "application/json" }));
  const summary = driveNoteSummary(saved, rootId);
  if (summary.noteKey !== noteKey || summary.containerId !== containerId) throw new Error("Driveへ保存したノートを確認できませんでした。");
  return summary;
}

export async function listDriveNotes(access: DriveNoteAccess, rootId: string, pageToken?: string): Promise<{ notes: DriveNoteSummary[]; nextPageToken?: string }> {
  driveId(rootId);
  if (pageToken !== undefined && (pageToken.length > 4096 || /[\u0000-\u001f]/.test(pageToken))) throw new Error("Drive一覧の続き情報が不正です。");
  const value = driveObject(await access.json("files", {
    q: noteQuery(rootId, true),
    spaces: "drive", corpora: "user", pageSize: "50", orderBy: "modifiedTime desc",
    fields: `files(${DRIVE_NOTE_FIELDS}),nextPageToken,incompleteSearch`, ...(pageToken ? { pageToken } : {}),
  }));
  if (value.incompleteSearch === true) throw new Error("Driveの一覧を検索しきれませんでした。再読み込みしてください。");
  if (!Array.isArray(value.files) || value.files.length > 50
    || (value.nextPageToken !== undefined && (typeof value.nextPageToken !== "string" || value.nextPageToken.length > 4096))) {
    throw new Error("Driveの一覧情報が不正です。");
  }
  const notes = value.files.map((file) => driveNoteSummary(file, rootId));
  if (new Set(notes.map((note) => note.id)).size !== notes.length) throw new Error("Driveの一覧に重複があります。");
  return { notes, ...(value.nextPageToken ? { nextPageToken: value.nextPageToken as string } : {}) };
}

// 取得済みメタデータは同じ読み込み操作内だけで渡す。永続キャッシュとして再利用しない。
export async function readDriveSource(access: DriveNoteAccess, rootId: string, noteId: string, initialMetadata?: unknown) {
  driveId(rootId); driveId(noteId);
  const metadata = { ...driveObject(initialMetadata ?? await access.json(`files/${noteId}`, { fields: DRIVE_NOTE_FIELDS })) };
  const summary = driveNoteSummary(metadata, rootId);
  if (summary.id !== noteId) throw new Error("Driveノートの識別情報が一致しません。");
  const size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > BACKUP_LIMITS.jsonBytes) throw new Error("Driveノートの編集情報は16MiB以下である必要があります。");
  const verifyLocation = async () => {
    const container = driveFile(await access.json(`files/${summary.containerId}`, { fields: DRIVE_NOTE_FIELDS }), "note-container", rootId, summary.noteKey);
    if (container.id !== summary.containerId) throw new Error("Driveノートの保存場所が一致しません。");
    await (await import("./driveLibraryRemote")).verifyLibraryAncestry(access, container, rootId);
  };
  const readContent = async () => {
    const data = await access.download(noteId, BACKUP_LIMITS.jsonBytes);
    if (data.size !== size) throw new Error("Driveノートの編集中または破損の可能性があります。再読み込みしてください。");
    let raw: unknown;
    try { raw = JSON.parse(await data.text()); } catch { throw new Error("Driveノートの編集情報を読み取れませんでした。"); }
    const manifest = readDriveManifest(raw, summary.noteKey);
    if (manifest.sync) {
      const { sha256, driveManifestContent } = await import("./driveAutosaveRemote");
      if (manifest.sync.hash !== await sha256(new Blob([JSON.stringify(driveManifestContent(manifest))]))) throw new Error("Driveの編集内容の検証に失敗しました。");
    }
    if (summary.deviceId !== manifest.sync?.deviceId) throw new Error("Driveノートの端末情報が一致しません。");
    const pdfMetadata = driveFile(await access.json(`files/${manifest.pdfId}`, { fields: DRIVE_NOTE_FIELDS }), "pdf", rootId, summary.noteKey, summary.containerId);
    if (pdfMetadata.id !== manifest.pdfId || Number(pdfMetadata.size) !== manifest.pdfBytes) throw new Error("DriveノートのPDF情報が一致しません。");
    return { manifest, pdfMetadata };
  };
  // 独立した読み取りだけを並行化する。両方の検証成功まではPDF本文を取得しない。
  const [, { manifest, pdfMetadata }] = await Promise.all([verifyLocation(), readContent()]);
  return { metadata, summary, manifest, pdfMetadata };
}

export async function loadDriveNote(access: DriveNoteAccess, rootId: string, noteId: string): Promise<NoteBackup> {
  return (await loadDriveNoteDetails(access, rootId, noteId)).backup;
}

export async function loadDriveNoteDetails(access: DriveNoteAccess, rootId: string, noteId: string, initialMetadata?: unknown) {
  const { manifest, metadata, summary, pdfMetadata } = await readDriveSource(access, rootId, noteId, initialMetadata);
  const expectedVersion = version(metadata.version);
  // 早期の二重取得をやめ、PDF取得と並行して後段の版を確認する。
  const [pdf, latestValue] = await Promise.all([
    access.download(manifest.pdfId, BACKUP_LIMITS.bytes),
    access.json(`files/${noteId}`, { fields: DRIVE_NOTE_FIELDS }),
  ]);
  const latest = driveNoteSummary(latestValue, rootId);
  if (latest.id !== noteId || latest.noteKey !== summary.noteKey || latest.containerId !== summary.containerId
    || latest.deviceId !== summary.deviceId || version(driveObject(latestValue).version) !== expectedVersion) {
    throw new Error("取得中にDriveノートが変わりました。再度開いてください。");
  }
  if (pdf.size !== manifest.pdfBytes || !((await pdf.slice(0, 1024).text()).includes("%PDF-"))) throw new Error("DriveノートのPDFが不正です。");
  const pdfHash = await (await import("./driveAutosaveRemote")).sha256(pdf);
  if (pdfMetadata.sha256Checksum !== undefined && pdfMetadata.sha256Checksum !== pdfHash) throw new Error("DriveのPDFの取得結果が一致しません。");
  if (manifest.pages || manifest.headingsByPage) {
    const { PDFDocument } = await import("pdf-lib");
    const original = await PDFDocument.load(await pdf.arrayBuffer(), { updateMetadata: false });
    checkPageBindings(manifest.pages, [manifest.strokesByPage, manifest.textsByPage, manifest.headingsByPage ?? {}], original.getPageCount());
  }
  const backup = readNoteBackup({ schemaVersion: manifest.headingsByPage ? 4 : manifest.pages ? 3 : 1, kind: "note", name: manifest.title, folders: [], notes: [{
    id: manifest.noteKey, title: manifest.title, fileName: manifest.fileName, folderId: null, pdf,
    ...(manifest.pages ? { pages: manifest.pages } : {}), ...(manifest.headingsByPage ? { headingsByPage: manifest.headingsByPage } : {}), strokesByPage: manifest.strokesByPage, textsByPage: manifest.textsByPage,
  }] });
  return { backup, manifest, metadata, summary, pdfHash };
}

// 利用者が指定した1件の手動上書き。事前のversion比較は原子的な条件付き更新ではない。
// 同時保存の最終競合は防げないため、確認画面で案内し、自動同期には転用しない。
export async function overwriteDriveNote(access: DriveNoteAccess, rootId: string, input: NoteBackup, target: DriveOverwriteTarget): Promise<DriveNoteSummary> {
  if (!access.replace) throw new Error("Driveの上書き保存を利用できません。");
  const note = singleDriveNote(input);
  if (note.title !== target.note.title) throw new Error("確認したノート名が変わりました。保存対象を選び直してください。");
  const source = await readDriveSource(access, rootId, target.note.id);
  if (source.summary.deviceId) throw new Error("自動保存用ノートは手動で上書きできません。別ノートとして保存してください。");
  if (version(source.metadata.version) !== target.version || source.summary.containerId !== target.note.containerId
    || source.summary.noteKey !== target.note.noteKey || source.summary.title !== target.note.title) throw new Error("確認後にDriveノートが変更されました。キャンセルして保存対象を選び直してください。");
  if (!((await note.pdf.slice(0, 1024).text()).includes("%PDF-"))) throw new Error("保存するPDFの形式が不正です。");
  const edits = new Blob([JSON.stringify({ headings: note.headingsByPage, pages: note.pages, strokes: note.strokesByPage, texts: note.textsByPage })]);
  if (edits.size > BACKUP_LIMITS.jsonBytes - 4096) throw new Error("編集データが大きすぎます。編集情報16MiB以下で保存してください。");
  const checksum = source.pdfMetadata.sha256Checksum;
  const canCompare = typeof checksum === "string" && /^[a-fA-F0-9]{64}$/.test(checksum) && note.pdf.size === source.manifest.pdfBytes;
  // 比較する1件だけの一時バッファ。ハッシュ・PDFキャッシュをDBに追加しない。
  const digest = canCompare && crypto.subtle
    ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", await note.pdf.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("") : null;
  let pdfId = source.manifest.pdfId;
  if (!digest || digest !== (checksum as string).toLowerCase()) {
    const uploaded = driveFile(await access.upload({ name: note.fileName, mimeType: "application/pdf", parents: [source.summary.containerId],
      appProperties: { overlayApp: "overlay", overlaySchema: "1", overlayRole: "pdf", overlayRootId: rootId, overlayNoteKey: source.summary.noteKey },
    }, note.pdf), "pdf", rootId, source.summary.noteKey, source.summary.containerId);
    if (Number(uploaded.size) !== note.pdf.size) throw new Error("Driveへ送信したPDFのサイズが一致しません。");
    pdfId = driveId(uploaded.id);
  }
  const [latestValue, reusedPdf] = await Promise.all([
    access.json(`files/${target.note.id}`, { fields: DRIVE_NOTE_FIELDS }),
    pdfId === source.manifest.pdfId ? access.json(`files/${pdfId}`, { fields: DRIVE_NOTE_FIELDS }) : null,
  ]);
  const latest = driveFile(latestValue, "note", rootId, source.summary.noteKey, source.summary.containerId);
  if (latest.id !== target.note.id || version(latest.version) !== target.version) throw new Error("確認後にDriveノートが変更されました。キャンセルして保存対象を選び直してください。");
  if (reusedPdf) {
    const currentPdf = driveFile(reusedPdf, "pdf", rootId, source.summary.noteKey, source.summary.containerId);
    if (currentPdf.id !== pdfId || version(currentPdf.version) !== version(source.pdfMetadata.version)
      || currentPdf.sha256Checksum !== checksum || Number(currentPdf.size) !== note.pdf.size) {
      throw new Error("確認後にDriveの元PDFが変更されました。保存対象を選び直してください。");
    }
  }
  const manifest: DriveNoteManifest = { schemaVersion: note.headingsByPage ? 3 : note.pages ? 2 : 1, ...(note.headingsByPage ? { headingsByPage: note.headingsByPage } : {}), ...(note.pages ? { pages: note.pages } : {}), kind: "overlay-drive-note", noteKey: source.summary.noteKey,
    title: note.title, fileName: note.fileName, pdfId, pdfBytes: note.pdf.size, strokesByPage: note.strokesByPage, textsByPage: note.textsByPage };
  const saved = driveNoteSummary(await access.replace(target.note.id, new Blob([JSON.stringify(manifest)], { type: "application/json" })), rootId);
  if (saved.id !== target.note.id || saved.title !== note.title || saved.containerId !== source.summary.containerId || saved.noteKey !== source.summary.noteKey) throw new Error("上書き保存の結果を確認できませんでした。");
  return saved;
}
