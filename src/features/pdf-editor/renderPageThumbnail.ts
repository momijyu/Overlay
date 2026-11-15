import type { PDFDocumentProxy } from "pdfjs-dist";
import { blankPageTemplateLines, TEMPLATE_LINE_COLOR, TEMPLATE_LINE_WIDTH } from "./blankPageTemplate";
import { imageMatrix } from "./imageData";
import { LEGACY_TAPE_COLOR } from "./maskTapes";
import { loadNoteFont } from "./noteFont";
import { MARKER_OPACITY, PEN_COLOR } from "./penStyle";
import { THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH } from "./pageThumbnails";
import { STICKY_BACKGROUND, TEXT_PADDING, textNoteLayout } from "./textLayout";
import type { MaskTape, NoteImages, NotePage, PenStroke, TextNote } from "./types";

export type PageThumbnail = { canvas: HTMLCanvasElement; width: number; height: number };

export async function renderPageThumbnail(pdf: PDFDocumentProxy, entry: NotePage, signal: AbortSignal): Promise<PageThumbnail> {
  signal.throwIfAborted();
  const page = entry.kind === "pdf" ? await pdf.getPage(entry.pageNumber) : null;
  signal.throwIfAborted();
  const original = page ? page.getViewport({ scale: 1 }) : entry as Extract<NotePage, { kind: "blank" }>;
  const scale = Math.min(THUMBNAIL_WIDTH / original.width, THUMBNAIL_HEIGHT / original.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(original.width * scale));
  canvas.height = Math.max(1, Math.ceil(original.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  if (page) {
    const task = page.render({ canvas, viewport: page.getViewport({ scale }) });
    const cancel = () => task.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try { await task.promise; } finally { signal.removeEventListener("abort", cancel); }
  } else {
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(scale, scale);
    context.strokeStyle = TEMPLATE_LINE_COLOR; context.lineWidth = TEMPLATE_LINE_WIDTH;
    context.beginPath();
    for (const line of blankPageTemplateLines(entry.kind === "blank" ? entry.template : undefined, original.width, original.height)) {
      context.moveTo(line.x1, line.y1); context.lineTo(line.x2, line.y2);
    }
    context.stroke();
  }
  signal.throwIfAborted();
  return { canvas, width: original.width, height: original.height };
}

function imageElement(blob: Blob, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const url = URL.createObjectURL(blob), image = new Image();
    const clear = () => { URL.revokeObjectURL(url); signal.removeEventListener("abort", abort); image.onload = image.onerror = null; };
    const abort = () => { clear(); image.src = ""; reject(signal.reason); };
    image.onload = () => { clear(); resolve(image); };
    image.onerror = () => { clear(); reject(new Error("画像を表示できませんでした。")); };
    signal.addEventListener("abort", abort, { once: true });
    image.src = url;
  });
}

// メインの編集レイヤーや入力イベントは作らず、低解像度Canvasに確定済みの内容だけ描く。
export async function paintThumbnailAnnotations(canvas: HTMLCanvasElement, base: PageThumbnail, pageId: number,
  strokes: readonly PenStroke[], texts: readonly TextNote[], tapes: readonly MaskTape[], images: NoteImages | undefined, signal: AbortSignal) {
  const font = texts.length ? await loadNoteFont() : null;
  signal.throwIfAborted();
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  canvas.width = base.canvas.width; canvas.height = base.canvas.height;
  context.drawImage(base.canvas, 0, 0);
  context.scale(canvas.width / base.width, canvas.height / base.height);
  for (const image of images?.byPage[pageId] ?? []) {
    const asset = images!.assets[image.assetId];
    if (!asset) continue;
    const element = await imageElement(asset.blob, signal);
    signal.throwIfAborted();
    const m = imageMatrix(image, asset, base.width, base.height);
    context.save();
    context.beginPath(); context.rect(image.x * base.width, image.y * base.height, image.width * base.width, image.height * base.height); context.clip();
    context.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    context.drawImage(element, 0, 0, asset.width, asset.height); context.restore();
  }
  for (const stroke of [...strokes.filter(s => s.kind === "fill"), ...strokes.filter(s => s.kind !== "fill")]) {
    const first = stroke.points[0]; if (!first) continue;
    context.save();
    context.strokeStyle = context.fillStyle = stroke.color ?? PEN_COLOR;
    context.lineWidth = stroke.width; context.lineCap = context.lineJoin = "round";
    if (stroke.kind === "marker") { context.globalAlpha = MARKER_OPACITY; context.globalCompositeOperation = "multiply"; }
    context.beginPath(); context.moveTo(first.x * base.width, first.y * base.height);
    for (const point of stroke.points.slice(1)) context.lineTo(point.x * base.width, point.y * base.height);
    if (stroke.kind === "fill") { context.closePath(); context.fill("evenodd"); }
    else if (stroke.points.every(p => p.x === first.x && p.y === first.y)) {
      context.arc(first.x * base.width, first.y * base.height, stroke.width / 2, 0, Math.PI * 2); context.fill();
    } else context.stroke();
    context.restore();
  }
  for (const note of texts) {
    const layout = textNoteLayout(note, base.width, font!.font, base.height);
    const x = note.x * base.width, y = note.y * base.height;
    if (note.kind === "sticky") {
      context.fillStyle = note.backgroundColor ?? STICKY_BACKGROUND;
      context.fillRect(x, y, layout.width, layout.height);
    }
    context.fillStyle = note.color ?? PEN_COLOR;
    context.font = `${note.fontSize}px OverlayNotes`; context.textBaseline = "alphabetic";
    layout.lines.forEach((line, i) => context.fillText(line, x + TEXT_PADDING, y + layout.baseline + i * layout.lineHeight));
  }
  for (const tape of tapes) {
    context.fillStyle = tape.color ?? LEGACY_TAPE_COLOR;
    context.fillRect(tape.x * base.width, tape.y * base.height, tape.width * base.width, tape.height * base.height);
  }
}
