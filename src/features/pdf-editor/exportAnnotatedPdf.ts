import { checkPageBindings, resolveNotePages } from "./notePages";
import { blankPageTemplateLines, TEMPLATE_LINE_COLOR, TEMPLATE_LINE_WIDTH } from "./blankPageTemplate";
import { validatePdfPageSelection } from "./pdfPageSelection";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { MARKER_OPACITY, PEN_COLOR } from "./penStyle";
import { readStrokes } from "./strokeData";
import type { NotePage, PenPoint, PenStroke, TextNotesByPage } from "./types";
import { readTextNotes } from "./textData";
import { loadNoteFont } from "./noteFont";
import { textNoteLayout, TEXT_PADDING, STICKY_BACKGROUND } from "./textLayout";

export async function exportAnnotatedPdf(
  file: File,
  displayedDocument: PDFDocumentProxy,
  strokesByPage: Record<number, PenStroke[]>,
  textsByPage?: TextNotesByPage,
  pages?: NotePage[],
  selectedPageNumbers?: readonly number[],
): Promise<Uint8Array> {
  const { PDFDocument, LineCapStyle, LineJoinStyle, BlendMode, pushGraphicsState, popGraphicsState, setLineJoin, rgb, degrees } = await import("pdf-lib");
  const toColor = (color: string) => rgb(parseInt(color.slice(1, 3), 16) / 255,
    parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255);
  const checkedStrokes = readStrokes(strokesByPage);
  const checkedTexts = readTextNotes(textsByPage);
  const source = await PDFDocument.load(await file.arrayBuffer());
  if (source.getPageCount() !== displayedDocument.numPages) throw new Error("元PDFのページ数が一致しません。");
  checkPageBindings(pages, [checkedStrokes, checkedTexts], displayedDocument.numPages);
  const allPages = resolveNotePages(pages, displayedDocument.numPages);
  const layout = selectedPageNumbers === undefined ? allPages
    : validatePdfPageSelection(selectedPageNumbers, allPages.length).map((number) => allPages[number - 1]);
  const pdf = selectedPageNumbers === undefined ? source : await PDFDocument.create();
  if (selectedPageNumbers !== undefined) {
    // 抜粋は新しいPDFへ必要なページだけをコピーする。
    const originals = layout.filter((page) => page.kind === "pdf");
    for (const copied of await pdf.copyPages(source, originals.map((page) => page.pageNumber - 1))) pdf.addPage(copied);
  }
  // 出力する元ページだけを残す。逆順に除外し、元PDFのBlob・ページIDは変更しない。
  const retained = new Set(layout.filter((page) => page.kind === "pdf").map((page) => page.pageNumber));
  if (selectedPageNumbers === undefined) {
    for (let index = pdf.getPageCount() - 1; index >= 0; index--) {
      if (!retained.has(index + 1)) pdf.removePage(index);
    }
  }
  const fontData = layout.some((page) => checkedTexts[page.id]?.length) ? await loadNoteFont() : null;
  const outputFont = fontData ? await (async () => {
    pdf.registerFontkit((await import("@pdf-lib/fontkit")).default);
    // CFFの部分埋め込みで一部の日本語字形が壊れるため、このフォントは全体を埋め込む。
    return pdf.embedFont(fontData.bytes, { subset: false, features: { liga: false, kern: false } });
  })() : null;

  for (const [index, entry] of layout.entries()) {
    // 出力用のPDFにだけ白紙を挿入する。保存している元PDFは変更しない。
    if (entry.kind === "blank") {
      const blank = pdf.insertPage(index, [entry.width, entry.height]);
      for (const line of blankPageTemplateLines(entry.template, entry.width, entry.height)) {
        blank.drawLine({ start: { x: line.x1, y: entry.height - line.y1 }, end: { x: line.x2, y: entry.height - line.y2 },
          thickness: TEMPLATE_LINE_WIDTH, color: toColor(TEMPLATE_LINE_COLOR) });
      }
    }
    const strokes = checkedStrokes[entry.id] ?? [];
    const texts = checkedTexts[entry.id] ?? [];
    if (strokes.length === 0 && texts.length === 0) continue;

    const viewport = entry.kind === "blank"
      ? { width: entry.width, height: entry.height, convertToPdfPoint: (x: number, y: number) => [x, entry.height - y] }
      : (await displayedDocument.getPage(entry.pageNumber)).getViewport({ scale: 1 });
    const outputPage = pdf.getPage(index);

    function toPdfPoint(point: PenPoint) {
      // PDF.js の表示座標から元PDFの座標へ戻し、回転したページにも対応する。
      const [x, y] = viewport.convertToPdfPoint(
        point.x * viewport.width,
        point.y * viewport.height,
      );
      return { x, y };
    }

    for (const stroke of [...strokes.filter((stroke) => stroke.kind === "fill"), ...strokes.filter((stroke) => stroke.kind !== "fill")]) {
      const color = stroke.color ?? PEN_COLOR;
      const penColor = toColor(color);
      if (stroke.kind === "fill") {
        const path = stroke.points.map((point, index) => {
          const { x, y } = toPdfPoint(point);
          return `${index === 0 ? "M" : "L"} ${x} ${-y}`;
        }).join(" ") + " Z";
        outputPage.drawSvgPath(path, { x: 0, y: 0, color: penColor, borderWidth: 0 });
        continue;
      }
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
        if (layout.height > viewport.height + 0.001) throw new Error("テキストがページの高さを超えています。");
        // 書き込み自体が収まる場合は出力時の位置だけを補正する。保存データを変更しない。
        const top = Math.max(0, Math.min(note.y * viewport.height, viewport.height - layout.height));
        if (note.kind === "sticky") {
          const [x, y] = viewport.convertToPdfPoint(note.x * viewport.width, top + layout.height);
          outputPage.drawRectangle({ x, y, width: layout.width * unitScale, height: layout.height * unitScale,
            rotate: degrees(angle), color: toColor(note.backgroundColor ?? STICKY_BACKGROUND) });
        }
        layout.lines.forEach((line, index) => {
          if (!line) return;
          const [x, y] = viewport.convertToPdfPoint(note.x * viewport.width + TEXT_PADDING,
            top + layout.baseline + layout.lineHeight * index);
          outputPage.drawText(line, { x, y, font: outputFont, size: note.fontSize * unitScale,
            rotate: degrees(angle), color: toColor(note.color ?? PEN_COLOR) });
        });
      }
    }
  }

  return pdf.save();
}
