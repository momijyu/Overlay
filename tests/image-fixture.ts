import { zlibSync } from "fflate";
import { imageHash } from "@/features/pdf-editor/imageData";
import type { NoteImages } from "@/features/pdf-editor/types";

function chunk(type: string, bytes: Uint8Array) {
  const data = new Uint8Array(bytes.length + 12), view = new DataView(data.buffer);
  view.setUint32(0, bytes.length); data.set(new TextEncoder().encode(type), 4); data.set(bytes, 8);
  let crc = -1;
  for (const b of data.subarray(4, -4)) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(data.length - 4, (crc ^ -1) >>> 0);
  return data;
}
// 左上赤・右上青・左下緑・右下白。画像の回転と切り抜きを色で検証する。
export function testPng() {
  const header = new Uint8Array(13); const view = new DataView(header.buffer);
  view.setUint32(0, 2); view.setUint32(4, 2); header[8] = 8; header[9] = 2;
  return new Blob([new Uint8Array([137,80,78,71,13,10,26,10]), chunk("IHDR", header),
    chunk("IDAT", zlibSync(new Uint8Array([0,255,0,0,0,0,255,0,0,255,0,255,255,255]))), chunk("IEND", new Uint8Array())], { type: "image/png" });
}
export async function imageFixture(): Promise<NoteImages> {
  const blob = testPng(), id = await imageHash(blob);
  return { assets: { [id]: { blob, width: 2, height: 2 } }, byPage: { 1: [
    { id: "image_A", assetId: id, x: .1, y: .1, width: .4, height: .4, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } },
  ] } };
}
