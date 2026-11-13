import type { ImageAsset, NoteImage, NoteImages } from "./types";

export const IMAGE_LIMITS = { bytes: 20 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, pixels: 16_000_000, totalPixels: 32_000_000, side: 8192, count: 40 };
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("画像データの形式が不正です。");
  return v as Record<string, unknown>;
};
const unit = (n: unknown, positive = false): number => {
  if (typeof n !== "number" || !Number.isFinite(n) || n < (positive ? 0.000001 : 0) || n > 1) throw new Error("画像の配置範囲が不正です。");
  return n;
};
export function checkImageDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > IMAGE_LIMITS.side || height > IMAGE_LIMITS.side || width * height > IMAGE_LIMITS.pixels) {
    throw new Error("画像は1,600万画素・一辺8,192px以下にしてください。");
  }
}
export function readImagePlacements(input: unknown): Record<number, NoteImage[]> {
  const result: Record<number, NoteImage[]> = {};
  const ids = new Set<string>();
  for (const [page, value] of Object.entries(object(input))) {
    if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)) || !Array.isArray(value)) throw new Error("画像のページ情報が不正です。");
    result[Number(page)] = value.map((item) => {
      const v = object(item); const c = object(v.crop);
      if (typeof v.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(v.id) || ids.has(v.id)
        || typeof v.assetId !== "string" || !/^[a-f0-9]{64}$/.test(v.assetId) || ![0, 90, 180, 270].includes(v.rotation as number)) throw new Error("画像の識別情報が不正です。");
      ids.add(v.id);
      if (ids.size > IMAGE_LIMITS.count) throw new Error("画像は1ノート40個までです。");
      const image: NoteImage = { id: v.id, assetId: v.assetId, x: unit(v.x), y: unit(v.y), width: unit(v.width, true), height: unit(v.height, true),
        rotation: v.rotation as NoteImage["rotation"], crop: { x: unit(c.x), y: unit(c.y), width: unit(c.width, true), height: unit(c.height, true) } };
      if (image.x + image.width > 1.000001 || image.y + image.height > 1.000001 || image.crop.x + image.crop.width > 1.000001
        || image.crop.y + image.crop.height > 1.000001) throw new Error("画像がページまたは切り抜き範囲を超えています。");
      return image;
    });
  }
  return result;
}
export function readNoteImages(input: unknown): NoteImages | undefined {
  if (input === undefined) return undefined;
  const value = object(input); const byPage = readImagePlacements(value.byPage); const assets: NoteImages["assets"] = {};
  const rawAssets = object(value.assets);
  if (Object.keys(rawAssets).length > IMAGE_LIMITS.count) throw new Error("元画像の件数が多すぎます。");
  let bytes = 0, pixels = 0;
  for (const [id, raw] of Object.entries(rawAssets)) {
    const asset = object(raw);
    if (!/^[a-f0-9]{64}$/.test(id) || !(asset.blob instanceof Blob) || !["image/png", "image/jpeg"].includes(asset.blob.type)
      || !asset.blob.size || asset.blob.size > IMAGE_LIMITS.bytes) throw new Error("画像は20MiB以下のPNG・JPEGにしてください。");
    checkImageDimensions(asset.width as number, asset.height as number);
    bytes += asset.blob.size;
    pixels += (asset.width as number) * (asset.height as number);
    if (pixels > IMAGE_LIMITS.totalPixels) throw new Error("元画像の合計は1ノート3,200万画素以下にしてください。");
    if (bytes > IMAGE_LIMITS.totalBytes) throw new Error("元画像の合計は1ノート64MiB以下にしてください。");
    assets[id] = { blob: asset.blob, width: asset.width as number, height: asset.height as number };
  }
  for (const image of Object.values(byPage).flat()) if (!assets[image.assetId]) throw new Error("元画像が見つかりません。");
  return { byPage, assets };
}
export function pruneImages(images: NoteImages): NoteImages {
  const used = new Set(Object.values(images.byPage).flat().map((i) => i.assetId));
  return { byPage: images.byPage, assets: Object.fromEntries(Object.entries(images.assets).filter(([id]) => used.has(id))) };
}
export const imageBytes = (images?: NoteImages) => Object.values(images?.assets ?? {}).reduce((n, a) => n + a.blob.size, 0);
export async function imageHash(blob: Blob) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// デコードする前にヘッダーから寸法を検査し、巨大な圧縮画像の展開を防ぐ。
export async function inspectRaster(blob: Blob): Promise<{ width: number; height: number; type: string; oriented: boolean }> {
  if (!blob.size || blob.size > IMAGE_LIMITS.bytes) throw new Error("画像は20MiB以下にしてください。");
  const b = new Uint8Array(await blob.arrayBuffer()); const v = new DataView(b.buffer);
  if (b.length >= 33 && [137,80,78,71,13,10,26,10].every((n, i) => b[i] === n) && String.fromCharCode(...b.slice(12,16)) === "IHDR") {
    const width = v.getUint32(16), height = v.getUint32(20); checkImageDimensions(width, height);
    for (let offset = 8; offset + 12 <= b.length;) {
      const size = v.getUint32(offset), type = String.fromCharCode(...b.slice(offset + 4, offset + 8));
      if (type === "acTL") throw new Error("アニメーションPNGには対応していません。静止画を選んでください。");
      if (offset + size + 12 > b.length) throw new Error("PNG画像が破損しています。");
      offset += size + 12;
      if (type === "IEND") break;
    }
    return { width, height, type: "image/png", oriented: false };
  }
  if (b[0] === 255 && b[1] === 216) {
    let offset = 2, width = 0, height = 0, oriented = false;
    while (offset + 4 <= b.length) {
      if (b[offset++] !== 255) break;
      while (b[offset] === 255) offset++;
      const marker = b[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const length = v.getUint16(offset);
      if (length < 2 || offset + length > b.length) break;
      if (marker === 225 && String.fromCharCode(...b.slice(offset+2,offset+8)) === "Exif\0\0") {
        const t = offset + 8;
        try {
          const little = v.getUint16(t) === 0x4949; const directory = t + v.getUint32(t+4,little);
          const count = v.getUint16(directory,little);
          for (let i=0;i<count && i<256;i++) {
            const p=directory+2+i*12;
            if (v.getUint16(p,little)===274) oriented = v.getUint16(p+8,little)!==1;
          }
        } catch { throw new Error("JPEGの向き情報が不正です。"); }
      }
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 8) {
        height = v.getUint16(offset+3); width = v.getUint16(offset+5);
      }
      offset += length;
    }
    checkImageDimensions(width,height); return { width,height,type:"image/jpeg",oriented };
  }
  throw new Error("PNG・JPEG画像を選んでください。HEIC・WebP等はPNGまたはJPEGに変換してください。");
}
export async function verifyImageAssets(images?: NoteImages) {
  for (const [id, a] of Object.entries(images?.assets ?? {})) {
    const info = await inspectRaster(a.blob);
    if (info.width !== a.width || info.height !== a.height || info.type !== a.blob.type || info.oriented || await imageHash(a.blob) !== id) throw new Error("元画像の内容を確認できませんでした。");
  }
}
export async function importImage(file: Blob): Promise<{ id: string; asset: ImageAsset }> {
  const info = await inspectRaster(file);
  let blob = file.slice(0,file.size,info.type);
  const bitmap = await createImageBitmap(blob);
  try {
    checkImageDimensions(bitmap.width, bitmap.height);
    if (info.oriented) {
      const canvas = document.createElement("canvas"); canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext("2d"); if (!ctx) throw new Error("画像を読み込めませんでした。");
      ctx.drawImage(bitmap,0,0);
      blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob((b)=>b?resolve(b):reject(new Error("写真の向きを補正できませんでした。")),"image/png"));
    }
    if (blob.size > IMAGE_LIMITS.bytes) throw new Error("向きを補正した画像が20MiBを超えています。");
    return { id: await imageHash(blob), asset: { blob, width: bitmap.width, height: bitmap.height } };
  } finally { bitmap.close(); }
}
export function fitImage(image: NoteImage, width: number, height: number, pageWidth: number, pageHeight: number): NoteImage {
  const scale = Math.min(1, 1 / width, 1 / height);
  width *= scale; height *= scale;
  // pageWidth/pageHeightを呼び出し側で使う寸法と揃える。
  if (!(pageWidth > 0 && pageHeight > 0)) throw new Error("ページ寸法が不正です。");
  return { ...image, width, height, x: Math.max(0, Math.min(1-width,image.x)), y: Math.max(0,Math.min(1-height,image.y)) };
}
export function cropImage(image: NoteImage, crop: NoteImage["crop"], asset: ImageAsset, pageWidth: number, pageHeight: number): NoteImage {
  const ratio = crop.width * asset.width / (crop.height * asset.height);
  const height = image.rotation % 180 ? image.width * pageWidth * ratio / pageHeight : image.width * pageWidth / ratio / pageHeight;
  return fitImage({ ...image, crop }, image.width, height, pageWidth, pageHeight);
}
export function resizeImage(image: NoteImage, dx: number, dy: number): NoteImage {
  const minimum = Math.max(0.0001 / image.width, 0.0001 / image.height);
  const requested = 1 + (Math.abs(dx) > Math.abs(dy) ? dx / image.width : dy / image.height);
  const factor = Math.min((1 - image.x) / image.width, (1 - image.y) / image.height, Math.max(minimum, requested));
  return { ...image, width: image.width * factor, height: image.height * factor };
}
export function rotateImage(image: NoteImage, pageWidth: number, pageHeight: number): NoteImage {
  return fitImage({ ...image, rotation: ((image.rotation+90)%360) as NoteImage["rotation"] }, image.height*pageHeight/pageWidth, image.width*pageWidth/pageHeight, pageWidth,pageHeight);
}
// 元画像座標を切り抜き・回転後の表示枠へ写す行列。SVGとPDFで共用する。
export function imageMatrix(image: NoteImage, asset: ImageAsset, pw: number, ph: number) {
  const c=image.crop; const cw=c.width*asset.width,ch=c.height*asset.height;
  const w=image.width*pw,h=image.height*ph;
  const sx=w/(image.rotation%180?ch:cw),sy=h/(image.rotation%180?cw:ch);
  const r=image.rotation;
  const [a,b,cc,d,e,f]=r===0?[sx,0,0,sy,0,0]:r===90?[0,sy,-sx,0,w,0]:r===180?[-sx,0,0,-sy,w,h]:[0,-sy,sx,0,0,h];
  return { a,b,c:cc,d,e:image.x*pw+e-a*c.x*asset.width-cc*c.y*asset.height,
    f:image.y*ph+f-b*c.x*asset.width-d*c.y*asset.height };
}
