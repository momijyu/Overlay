import { checkImageDimensions, IMAGE_LIMITS, readImagePlacements, readNoteImages, verifyImageAssets } from "./imageData";
import { DRIVE_NOTE_FIELDS, driveFile, driveId, driveObject } from "./googleDriveNoteData";
import type { DriveNoteAccess } from "./googleDriveNotes";
import type { NoteImages } from "./types";

export type DriveImages = { byPage: NoteImages["byPage"]; assets: Record<string, { fileId: string; width: number; height: number; bytes: number; type: string }> };
export function readDriveImages(value: unknown): DriveImages | undefined {
  if (value === undefined) return undefined;
  const v = driveObject(value), raw = driveObject(v.assets), assets: DriveImages["assets"] = {};
  const byPage = readImagePlacements(v.byPage);
  if (Object.keys(raw).length > IMAGE_LIMITS.count) throw new Error("Driveの画像件数が多すぎます。");
  let total = 0, pixels = 0;
  for (const [hash, input] of Object.entries(raw)) {
    const a = driveObject(input);
    checkImageDimensions(a.width as number, a.height as number);
    if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(a.bytes) || (a.bytes as number) < 1 || (a.bytes as number) > IMAGE_LIMITS.bytes
      || !["image/png", "image/jpeg"].includes(a.type as string)) throw new Error("Driveの画像情報が不正です。");
    total += a.bytes as number;
    pixels += (a.width as number) * (a.height as number);
    if (pixels > IMAGE_LIMITS.totalPixels) throw new Error("Driveの画像の合計画素数が多すぎます。");
    if (total > IMAGE_LIMITS.totalBytes) throw new Error("Driveの画像容量が大きすぎます。");
    assets[hash] = { fileId: driveId(a.fileId), width: a.width as number, height: a.height as number, bytes: a.bytes as number, type: a.type as string };
  }
  for (const i of Object.values(byPage).flat()) if (!assets[i.assetId]) throw new Error("Driveの元画像が不足しています。");
  return { byPage, assets };
}
function checked(value: unknown, root: string, key: string, parent: string, hash: string, descriptor: { bytes: number; type: string }) {
  const file = driveFile(value, "image", root, key, parent);
  if (driveObject(file.appProperties).overlayImageHash !== hash || Number(file.size) !== descriptor.bytes
    || file.mimeType !== descriptor.type || file.sha256Checksum !== hash) throw new Error("Driveの元画像の整合性を確認できませんでした。");
  return driveId(file.id);
}
// 元画像は不変。同じコンテナの検証済みファイルだけを再利用し、JSONの保存より先にアップロードを完了する。
export async function saveDriveImages(access: DriveNoteAccess, root: string, key: string, parent: string, images?: NoteImages): Promise<DriveImages | undefined> {
  if (!images) return undefined;
  const assets: DriveImages["assets"] = {};
  for (const [hash, asset] of Object.entries(images.assets)) {
    const descriptor = { width: asset.width, height: asset.height, bytes: asset.blob.size, type: asset.blob.type };
    const result = driveObject(await access.json("files", { q: `trashed = false and '${driveId(parent)}' in parents and appProperties has { key='overlayImageHash' and value='${hash}' }`,
      spaces: "drive", corpora: "user", pageSize: "100", fields: `files(${DRIVE_NOTE_FIELDS}),nextPageToken,incompleteSearch` }));
    if (!Array.isArray(result.files) || result.nextPageToken || result.incompleteSearch) throw new Error("Driveの元画像を確認しきれませんでした。");
    let fileId: string;
    if (result.files.length) {
      fileId = checked(result.files[0], root, key, parent, hash, descriptor);
      for (const file of result.files.slice(1)) checked(file, root, key, parent, hash, descriptor);
    } else {
      // 新しい画像だけ検証・送信する。位置変更やペン入力では画像のバイト列を再送しない。
      await verifyImageAssets({ byPage: {}, assets: { [hash]: asset } });
      const value = await access.upload({ name: `${hash}.${descriptor.type === "image/png" ? "png" : "jpg"}`, mimeType: descriptor.type, parents: [parent],
        appProperties: { overlayApp: "overlay", overlaySchema: "1", overlayRole: "image", overlayRootId: root, overlayNoteKey: key, overlayImageHash: hash } }, asset.blob);
      const id = driveId(driveObject(value).id);
      fileId = checked(await access.json(`files/${id}`, { fields: DRIVE_NOTE_FIELDS }), root, key, parent, hash, descriptor);
    }
    assets[hash] = { ...descriptor, fileId };
  }
  // 読み戻し時と項目順もそろえ、自動保存の内容ハッシュを再現できるようにする。
  return readDriveImages({ byPage: images.byPage, assets });
}
export async function loadDriveImages(access: DriveNoteAccess, root: string, key: string, parent: string, images?: DriveImages): Promise<NoteImages | undefined> {
  if (!images) return undefined;
  const assets: NoteImages["assets"] = {};
  // 同時に大量の画像を展開しない。必要なノートを開くときだけ取得する。
  for (const [hash, a] of Object.entries(images.assets)) {
    checked(await access.json(`files/${a.fileId}`, { fields: DRIVE_NOTE_FIELDS }), root, key, parent, hash, a);
    const bytes = await access.download(a.fileId, a.bytes);
    if (bytes.size !== a.bytes) throw new Error("Driveの元画像のサイズが一致しません。");
    assets[hash] = { blob: bytes.slice(0, bytes.size, a.type), width: a.width, height: a.height };
  }
  const result = readNoteImages({ byPage: images.byPage, assets });
  await verifyImageAssets(result);
  return result;
}
