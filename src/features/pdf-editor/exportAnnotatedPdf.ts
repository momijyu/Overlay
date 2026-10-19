import type { PDFDocumentProxy } from "pdfjs-dist";

import { PEN_COLOR } from "./penStyle";
import { readStrokes } from "./strokeData";
import type { PenPoint, PenStroke } from "./types";

export async function exportAnnotatedPdf(
  file: File,
  displayedDocument: PDFDocumentProxy,
  strokesByPage: Record<number, PenStroke[]>,
): Promise<Uint8Array> {
  const { PDFDocument, LineCapStyle, rgb } = await import("pdf-lib");
  const checkedStrokes = readStrokes(strokesByPage);
  const pdf = await PDFDocument.load(await file.arrayBuffer());

  for (let pageNumber = 1; pageNumber <= displayedDocument.numPages; pageNumber++) {
    const strokes = checkedStrokes[pageNumber] ?? [];
    if (strokes.length === 0) continue;

    const displayedPage = await displayedDocument.getPage(pageNumber);
    const viewport = displayedPage.getViewport({ scale: 1 });
    const outputPage = pdf.getPage(pageNumber - 1);

    function toPdfPoint(point: PenPoint) {
      // PDF.js の表示座標から元PDFの座標へ戻し、回転したページにも対応する。
      const [x, y] = viewport.convertToPdfPoint(
        point.x * viewport.width,
        point.y * viewport.height,
      );
      return { x, y };
    }

    for (const stroke of strokes) {
      const color = stroke.color ?? PEN_COLOR;
      const penColor = rgb(
        parseInt(color.slice(1, 3), 16) / 255,
        parseInt(color.slice(3, 5), 16) / 255,
        parseInt(color.slice(5, 7), 16) / 255,
      );
      const [first, ...rest] = stroke.points;
      if (!first) continue;

      if (rest.every((point) => point.x === first.x && point.y === first.y)) {
        const { x, y } = toPdfPoint(first);
        outputPage.drawCircle({ x, y, size: stroke.width / 2, color: penColor });
        continue;
      }

      let previous = first;
      for (const point of rest) {
        outputPage.drawLine({
          start: toPdfPoint(previous),
          end: toPdfPoint(point),
          thickness: stroke.width,
          color: penColor,
          lineCap: LineCapStyle.Round,
        });
        previous = point;
      }
    }
  }

  return pdf.save();
}
