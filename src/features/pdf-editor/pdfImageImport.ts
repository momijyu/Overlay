import type { PDFDocumentProxy, PDFDocumentLoadingTask } from "pdfjs-dist";
import { checkImageDimensions, IMAGE_LIMITS, imageHash } from "./imageData";
import type { ImageAsset } from "./types";

export const PDF_IMAGE_MAX_BYTES = 50 * 1024 * 1024;
export type ImportedPdfImage = { id: string; asset: ImageAsset };

export async function openPdfForImage(file: File, signal: AbortSignal): Promise<PDFDocumentProxy> {
  if (!file.size || file.size > PDF_IMAGE_MAX_BYTES) throw new Error("挿入するPDFは50MiB以下にしてください。");
  let task: PDFDocumentLoadingTask | undefined;
  const cancel = () => { void task?.destroy().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    const data = await file.arrayBuffer();
    signal.throwIfAborted();
    task = pdfjs.getDocument({ data: new Uint8Array(data), cMapUrl: "/pdfjs/cmaps/", cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/" });
    const pdf = await task.promise;
    signal.throwIfAborted();
    return pdf;
  } catch (error) {
    await task?.destroy().catch(() => {});
    if (signal.aborted) signal.throwIfAborted();
    throw new Error(error instanceof Error && error.name === "PasswordException"
      ? "パスワード付きPDFは、解除してから選んでください。" : "PDFを読み込めませんでした。破損やパスワード設定を確認してください。");
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

// 144dpiを基準に、長辺4,096px・800万画素に収める。画面倍率・端末DPRでは変えない。
export function pdfImageScale(width: number, height: number) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) throw new Error("PDFのページ寸法が不正です。");
  return Math.min(2, 4096 / width, 4096 / height, Math.sqrt(8_000_000 / width / height));
}

export async function renderPdfImage(pdf: PDFDocumentProxy, pageNumber: number, signal: AbortSignal): Promise<ImportedPdfImage> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) throw new Error("PDFのページ番号が不正です。");
  signal.throwIfAborted();
  const page = await pdf.getPage(pageNumber);
  const canvas = document.createElement("canvas");
  let cancel: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: pdfImageScale(original.width, original.height) });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    checkImageDimensions(canvas.width, canvas.height);
    const task = page.render({ canvas, viewport, background: "rgb(255,255,255)" });
    cancel = () => task.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    await task.promise;
    signal.throwIfAborted();
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PDFを画像に変換できませんでした。")), "image/png"));
    signal.throwIfAborted();
    if (blob.size > IMAGE_LIMITS.bytes) throw new Error("変換した画像が20MiBを超えています。別のページを選んでください。");
    const id = await imageHash(blob);
    signal.throwIfAborted();
    return { id, asset: { blob, width: canvas.width, height: canvas.height } };
  } finally {
    if (cancel) signal.removeEventListener("abort", cancel);
    page.cleanup();
    canvas.width = canvas.height = 0;
  }
}
