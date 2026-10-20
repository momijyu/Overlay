import type { PDFDocumentProxy } from "pdfjs-dist";

import { MARKER_OPACITY, PEN_COLOR } from "./penStyle";
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
  const { PDFDocument, LineCapStyle, LineJoinStyle, BlendMode, pushGraphicsState, popGraphicsState, setLineJoin, rgb, degrees } = await import("pdf-lib");
  const toColor = (color: string) => rgb(parseInt(color.slice(1, 3), 16) / 255,
    parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255);
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
      const penColor = toColor(color);
      const markerStyle = stroke.kind === "marker" ? { opacity: MARKER_OPACITY, blendMode: BlendMode.Multiply } : {};
      const [first, ...rest] = stroke.points;
      if (!first) continue;

      if (rest.every((point) => point.x === first.x && point.y === first.y)) {
        const { x, y } = toPdfPoint(first);
        outputPage.drawCircle({ x, y, size: stroke.width / 2, color: penColor, ...markerStyle });
        continue;
      }

      if (stroke.kind === "marker") {
        // 1本を一度だけ半透明で描く。線分ごとに描くと継ぎ目が重なって濃くなる。
        // drawSvgPathはY軸を反転するため、変換済みPDF座標のYを先に反転する。
        const path = stroke.points.map((point, index) => {
          const { x, y } = toPdfPoint(point);
          return `${index === 0 ? "M" : "L"} ${x} ${-y}`;
        }).join(" ");
        outputPage.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
        outputPage.drawSvgPath(path, { x: 0, y: 0, borderWidth: stroke.width, borderColor: penColor,
          borderLineCap: LineCapStyle.Round, borderOpacity: MARKER_OPACITY, blendMode: BlendMode.Multiply });
        outputPage.pushOperators(popGraphicsState());
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
            rotate: degrees(angle), color: toColor(note.backgroundColor ?? STICKY_BACKGROUND) });
        }
        layout.lines.forEach((line, index) => {
          if (!line) return;
          const [x, y] = viewport.convertToPdfPoint(note.x * viewport.width + TEXT_PADDING,
            note.y * viewport.height + layout.baseline + layout.lineHeight * index);
          outputPage.drawText(line, { x, y, font: outputFont, size: note.fontSize * unitScale,
            rotate: degrees(angle), color: toColor(note.color ?? PEN_COLOR) });
        });
      }
    }
  }

  return pdf.save();
}
