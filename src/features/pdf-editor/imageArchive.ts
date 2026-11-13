import { checkImageDimensions, IMAGE_LIMITS, readImagePlacements, readNoteImages, verifyImageAssets } from "./imageData";
import type { NoteImages } from "./types";

export async function packImages(images: NoteImages | undefined, entries: Record<string, Uint8Array>) {
  if (!images) return undefined;
  await verifyImageAssets(images);
  const assets: Record<string, { width: number; height: number; path: string; type: string }> = {};
  for (const [id, asset] of Object.entries(images.assets)) {
    const path = `images/${id}.${asset.blob.type === "image/png" ? "png" : "jpg"}`;
    entries[path] ??= new Uint8Array(await asset.blob.arrayBuffer());
    assets[id] = { width: asset.width, height: asset.height, path, type: asset.blob.type };
  }
  return { byPage: images.byPage, assets };
}
export async function unpackImages(value: unknown, entries: Record<string, Uint8Array>, used: Set<string>) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || !("assets" in value) || !("byPage" in value)
    || !value.assets || typeof value.assets !== "object" || Array.isArray(value.assets)) throw new Error("画像情報が不正です。");
  const byPage = readImagePlacements(value.byPage);
  const assets: NoteImages["assets"] = {};
  if (Object.keys(value.assets).length > IMAGE_LIMITS.count) throw new Error("画像件数が多すぎます。");
  for (const [id, raw] of Object.entries(value.assets)) {
    const a = raw as { width: number; height: number; path: string; type: string };
    if (!a || !/^[a-f0-9]{64}$/.test(id) || !["image/png", "image/jpeg"].includes(a.type)
      || a.path !== `images/${id}.${a.type === "image/png" ? "png" : "jpg"}` || !entries[a.path]) throw new Error("元画像が不足しています。");
    checkImageDimensions(a.width, a.height);
    used.add(a.path);
    assets[id] = { width: a.width, height: a.height, blob: new Blob([new Uint8Array(entries[a.path])], { type: a.type }) };
  }
  const images = readNoteImages({ byPage, assets })!;
  await verifyImageAssets(images);
  return images;
}
