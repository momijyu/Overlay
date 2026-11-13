import { clip, closePath, endPath, lineTo, moveTo, popGraphicsState, pushGraphicsState, degrees, type PDFDocument, type PDFImage, type PDFPage } from "pdf-lib";
import { imageMatrix } from "./imageData";
import type { NoteImages } from "./types";

type Viewport = { width: number; height: number; convertToPdfPoint(x: number, y: number): number[] };
export async function drawPageImages(pdf: PDFDocument, page: PDFPage, viewport: Viewport, pageId: number, images: NoteImages | undefined, embedded: Map<string, PDFImage>) {
  for (const image of images?.byPage[pageId] ?? []) {
    const asset = images!.assets[image.assetId];
    let raster = embedded.get(image.assetId);
    if (!raster) {
      const bytes = await asset.blob.arrayBuffer();
      raster = asset.blob.type === "image/png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      embedded.set(image.assetId, raster);
    }
    const m = imageMatrix(image, asset, viewport.width, viewport.height);
    const point = (x: number, y: number) => viewport.convertToPdfPoint(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
    const origin = point(0, asset.height), right = point(asset.width, asset.height), top = point(0, 0);
    const x = image.x * viewport.width, y = image.y * viewport.height, w = image.width * viewport.width, h = image.height * viewport.height;
    const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => viewport.convertToPdfPoint(a, b));
    page.pushOperators(pushGraphicsState(), moveTo(corners[0][0], corners[0][1]), ...corners.slice(1).map(([a, b]) => lineTo(a, b)), closePath(), clip(), endPath());
    page.drawImage(raster, { x: origin[0], y: origin[1], width: Math.hypot(right[0] - origin[0], right[1] - origin[1]),
      height: Math.hypot(top[0] - origin[0], top[1] - origin[1]), rotate: degrees(Math.atan2(right[1] - origin[1], right[0] - origin[0]) * 180 / Math.PI) });
    page.pushOperators(popGraphicsState());
  }
}
