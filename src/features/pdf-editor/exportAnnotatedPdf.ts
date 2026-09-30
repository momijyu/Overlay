import type { PDFDocumentProxy } from "pdfjs-dist";

import { PEN_COLOR, PEN_WIDTH } from "./penStyle";
import type { PenPoint, PenStroke } from "./types";

export async function exportAnnotatedPdf(
  file: File,
  displayedDocument: PDFDocumentProxy,
  strokesByPage: Record<number, PenStroke[]>,
): Promise<Uint8Array> {
  const { PDFDocument, LineCapStyle, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.load(await file.arrayBuffer());
  const penColor = rgb(
    parseInt(PEN_COLOR.slice(1, 3), 16) / 255,
    parseInt(PEN_COLOR.slice(3, 5), 16) / 255,
    parseInt(PEN_COLOR.slice(5, 7), 16) / 255,
  );

  for (let pageNumber = 1; pageNumber <= displayedDocument.numPages; pageNumber++) {
    const strokes = strokesByPage[pageNumber] ?? [];
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
      const [first, ...rest] = stroke.points;
      if (!first) continue;

      if (rest.every((point) => point.x === first.x && point.y === first.y)) {
        const { x, y } = toPdfPoint(first);
        outputPage.drawCircle({ x, y, size: PEN_WIDTH / 2, color: penColor });
        continue;
      }

      let previous = first;
      for (const point of rest) {
        outputPage.drawLine({
          start: toPdfPoint(previous),
          end: toPdfPoint(point),
          thickness: PEN_WIDTH,
          color: penColor,
          lineCap: LineCapStyle.Round,
        });
        previous = point;
      }
    }
  }

  return pdf.save();
}
