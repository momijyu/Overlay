import type { PDFDocumentProxy } from "pdfjs-dist";

import { PEN_COLOR } from "./penStyle";
import { readStrokes } from "./strokeData";
import type { PenPoint, PenStroke, TextNotesByPage } from "./types";
import { readTextNotes } from "./textData";
import { loadNoteFont } from "./noteFont";
import { textNoteLayout, TEXT_PADDING, STICKY_BACKGROUND } from "./textLayout";

export async function exportAnnotatedPdf(
  file: File,
  displayedDocument: PDFDocumentProxy,
  strokesByPage: Record<number, PenStroke[]>,
  textsByPage?: TextNotesByPage,
): Promise<Uint8Array> {
  const { PDFDocument, LineCapStyle, rgb, degrees } = await import("pdf-lib");
  const checkedStrokes = readStrokes(strokesByPage);
  const checkedTexts = readTextNotes(textsByPage);
  const pdf = await PDFDocument.load(await file.arrayBuffer());
  if ([...Object.keys(checkedStrokes), ...Object.keys(checkedTexts)].some((page) => Number(page) > displayedDocument.numPages)) {
    throw new Error("書き込み情報のページ数がPDFと一致しません。");
  }
  const fontData = Object.values(checkedTexts).some((notes) => notes.length > 0) ? await loadNoteFont() : null;
  const outputFont = fontData ? await (async () => {
    pdf.registerFontkit((await import("@pdf-lib/fontkit")).default);
    // CFFの部分埋め込みで一部の日本語字形が壊れるため、このフォントは全体を埋め込む。
    return pdf.embedFont(fontData.bytes, { subset: false, features: { liga: false, kern: false } });
  })() : null;

  for (let pageNumber = 1; pageNumber <= displayedDocument.numPages; pageNumber++) {
    const strokes = checkedStrokes[pageNumber] ?? [];
    const texts = checkedTexts[pageNumber] ?? [];
    if (strokes.length === 0 && texts.length === 0) continue;

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

    if (fontData && outputFont) {
      const origin = viewport.convertToPdfPoint(0, 0);
      const right = viewport.convertToPdfPoint(1, 0);
      const angle = Math.atan2(right[1] - origin[1], right[0] - origin[0]) * 180 / Math.PI;
      const unitScale = Math.hypot(right[0] - origin[0], right[1] - origin[1]);
      for (const note of texts) {
        const layout = textNoteLayout(note, viewport.width, fontData.font, viewport.height);
        if (note.y * viewport.height + layout.height > viewport.height + 0.001) throw new Error("テキストがページの高さを超えています。");
        if (note.kind === "sticky") {
          const [x, y] = viewport.convertToPdfPoint(note.x * viewport.width, note.y * viewport.height + layout.height);
          outputPage.drawRectangle({ x, y, width: layout.width * unitScale, height: layout.height * unitScale,
            rotate: degrees(angle), color: rgb(parseInt(STICKY_BACKGROUND.slice(1, 3), 16) / 255,
              parseInt(STICKY_BACKGROUND.slice(3, 5), 16) / 255, parseInt(STICKY_BACKGROUND.slice(5, 7), 16) / 255) });
        }
        layout.lines.forEach((line, index) => {
          if (!line) return;
          const [x, y] = viewport.convertToPdfPoint(note.x * viewport.width + TEXT_PADDING,
            note.y * viewport.height + layout.baseline + layout.lineHeight * index);
          outputPage.drawText(line, { x, y, font: outputFont, size: note.fontSize * unitScale,
            rotate: degrees(angle), color: rgb(17 / 255, 24 / 255, 39 / 255) });
        });
      }
    }
  }

  return pdf.save();
}
