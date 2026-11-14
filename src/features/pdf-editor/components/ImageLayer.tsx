"use client";

import { useEffect, useLayoutEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { ImageCropDialog } from "./ImageCropDialog";
import { PdfImageDialog } from "./PdfImageDialog";
import type { ImportedPdfImage } from "../pdfImageImport";
import { createPortal } from "react-dom";
import { cropImage, resizeImage, imageMatrix, importImage, readNoteImages, rotateImage } from "../imageData";
import type { PageInteraction } from "../pageGestures";
import type { ImageAsset, NoteImage, NoteImages } from "../types";

export function Raster({ asset, image, width, height }: { asset: ImageAsset; image: NoteImage; width: number; height: number }) {
  const raster = useRef<SVGImageElement>(null);
  const clip = useId().replaceAll(":", "");
  useEffect(() => { const url = URL.createObjectURL(asset.blob); raster.current?.setAttribute("href", url); return () => URL.revokeObjectURL(url); }, [asset.blob]);
  const m = imageMatrix(image, asset, width, height);
  return <g clipPath={`url(#${clip})`}>
    <defs><clipPath id={clip}><rect x={image.x * width} y={image.y * height} width={image.width * width} height={image.height * height} /></clipPath></defs>
    {/* 元画像の画素数は変更せず、表示だけ切り抜き・回転する。 */}
    <image ref={raster} width={asset.width} height={asset.height} transform={`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`} />
  </g>;
}

type Props = { scope: object; images?: NoteImages; pageId: number; width: number; height: number; scale: number; active: boolean; disabled: boolean;
  interaction: PageInteraction; controls: HTMLDivElement | null; onChange(images: NoteImages): void };
export function ImageLayer({ scope, images, pageId, width, height, scale, active, disabled, interaction, controls, onChange }: Props) {
  const svg = useRef<SVGSVGElement>(null), input = useRef<HTMLInputElement>(null);
  // 操作を始めた表示・保存内容にだけ草稿を適用する。道具変更やUndo後に持ち越さない。
  const context = useMemo(() => ({ scope, images, pageId, width, height, scale, active, disabled }),
    [scope, images, pageId, width, height, scale, active, disabled]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ image: NoteImage; context: object } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [pdfDraft, setPdfDraft] = useState<{ file: File; context: object; id: string } | null>(null);
  const pdfFile = pdfDraft?.context === context ? pdfDraft.file : null;
  const [cropDraft, setCropDraft] = useState<{ value: NoteImage["crop"]; context: object } | null>(null);
  const crop = cropDraft?.context === context ? cropDraft.value : null;
  const setCrop = (value: NoteImage["crop"] | null) => setCropDraft(value && { value, context });
  const pending = useRef<{ pointer: number; startX: number; startY: number; image: NoteImage; resize: boolean; context: object } | null>(null);
  const latest = useRef<NoteImage | null>(null);
  const generation = useRef({ ticket: 0 });
  useLayoutEffect(() => { const current = generation.current; current.ticket++; return () => { current.ticket++; }; }, [context]);
  function preview(value: NoteImage | null) { latest.current = value; setDraft(value && { image: value, context }); }
  const source = images?.byPage[pageId] ?? [];
  const chosen = source.find((i) => i.id === selected);
  useEffect(() => {
    const cancel = () => { pending.current = null; latest.current = null; setDraft(null); };
    interaction.cancellations.add(cancel);
    window.addEventListener("blur", cancel);
    return () => { interaction.cancellations.delete(cancel); window.removeEventListener("blur", cancel); };
  }, [interaction]);
  function commit(next: NoteImage[], assets = images?.assets ?? {}) {
    const checked = readNoteImages({ assets, byPage: { ...images?.byPage, [pageId]: next } });
    if (checked) onChange(checked);
  }
  function replace(image: NoteImage) { commit(source.map((i) => i.id === image.id ? image : i)); }
  function insert({ id, asset }: ImportedPdfImage) {
    if (!active || disabled || interaction.blocked) return;
    const factor = Math.min(width * .6 / asset.width, height * .6 / asset.height);
    const image: NoteImage = { id: crypto.randomUUID(), assetId: id, x: .1, y: .1,
      width: asset.width * factor / width, height: asset.height * factor / height, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } };
    commit([...source, image], { ...images?.assets, [id]: asset });
    setSelected(image.id);
  }
  async function add(file?: File) {
    if (!file || busy || disabled) return;
    const ticket = generation.current.ticket;
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      setError(null); setPdfDraft({ file, context, id: crypto.randomUUID() });
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(true); setError(null);
    try {
      const imported = await importImage(file);
      if (ticket !== generation.current.ticket) return;
      insert(imported);
    } catch (e) { setError(e instanceof Error ? e.message : "画像を追加できませんでした。"); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  function down(e: PointerEvent<SVGElement>, image: NoteImage, resize = false) {
    if (disabled || !active || busy || interaction.blocked || e.button !== 0) return;
    e.preventDefault(); setCrop(null); setSelected(image.id); preview(image);
    pending.current = { pointer: e.pointerId, startX: e.clientX, startY: e.clientY, image, resize, context };
    svg.current?.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const p = pending.current;
    if (!p || p.context !== context || p.pointer !== e.pointerId || interaction.blocked || !active || disabled) return;
    const dx = (e.clientX - p.startX) / (width * scale), dy = (e.clientY - p.startY) / (height * scale);
    if (p.resize) {
      preview(resizeImage(p.image, dx, dy));
    } else preview({ ...p.image, x: Math.max(0, Math.min(1 - p.image.width, p.image.x + dx)), y: Math.max(0, Math.min(1 - p.image.height, p.image.y + dy)) });
  }
  function finish(e: PointerEvent<SVGSVGElement>, cancel = false) {
    const p = pending.current; if (!p || p.pointer !== e.pointerId) return;
    pending.current = null;
    const next = latest.current; setDraft(null);
    if (!cancel && p.context === context && active && !disabled && !interaction.blocked && next && (next.x !== p.image.x || next.y !== p.image.y || next.width !== p.image.width || next.height !== p.image.height)) replace(next);
  }
  const currentDraft = draft?.context === context ? draft.image : null;
  const displayed = currentDraft ?? chosen;
  function reorder(direction: number) {
    if (!chosen) return;
    const index = source.indexOf(chosen), next = index + direction;
    if (next < 0 || next >= source.length) return;
    const list = [...source]; [list[index], list[next]] = [list[next], list[index]]; commit(list);
  }
  const toolbar = <div className="flex items-center gap-2" aria-label="画像の操作">
    <input ref={input} type="file" accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf" className="hidden" aria-label="挿入する画像・PDF" onChange={(e) => void add(e.target.files?.[0])} disabled={disabled || busy} />
    <button className="btn btn-sm" type="button" disabled={disabled || busy} onClick={() => input.current?.click()}>{busy ? "読み込み中…" : "画像・PDFを追加"}</button>
    {chosen && <>
      <button className="btn btn-sm" type="button" disabled={disabled || busy} onClick={() => replace(rotateImage(chosen, width, height))}>90°回転</button>
      <button className="btn btn-sm" type="button" onClick={() => setCrop(chosen.crop)} disabled={disabled || busy}>切り抜き</button>
      <button className="btn btn-sm" type="button" disabled={disabled || busy || source.indexOf(chosen) === source.length - 1} onClick={() => reorder(1)}>前へ</button>
      <button className="btn btn-sm" type="button" disabled={disabled || busy || source.indexOf(chosen) === 0} onClick={() => reorder(-1)}>後ろへ</button>
      <button className="btn btn-sm text-error" type="button" disabled={disabled || busy} onClick={() => { commit(source.filter((i) => i.id !== chosen.id)); setSelected(null); }}>画像削除</button>
    </>}
    {error && <span role="alert" className="w-64 whitespace-normal text-error text-sm">{error}</span>}
  </div>;
  return <>
    <svg ref={svg} className="absolute inset-0 touch-none" width={width * scale} height={height * scale} viewBox={`0 0 ${width} ${height}`}
      style={{ pointerEvents: active && !disabled ? "auto" : "none" }} aria-label="画像レイヤー"
      onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
      onPointerMove={move} onPointerUp={(e) => finish(e)} onPointerCancel={(e) => finish(e, true)} onLostPointerCapture={(e) => finish(e, true)}>
      {source.map((image) => {
        const shown = currentDraft?.id === image.id ? currentDraft : image, asset = images?.assets[image.assetId];
        return asset && <g key={image.id} onPointerDown={(e) => down(e, image)} style={{ cursor: active ? "move" : undefined }}>
          <Raster asset={asset} image={shown} width={width} height={height} />
          <rect x={shown.x * width} y={shown.y * height} width={shown.width * width} height={shown.height * height} fill="transparent" />
        </g>;
      })}
      {active && displayed && <g fill="white" stroke="#2563eb" strokeWidth={2 / scale}>
        <rect x={displayed.x * width} y={displayed.y * height} width={displayed.width * width} height={displayed.height * height} fill="none" />
        <rect x={(displayed.x + displayed.width) * width - 10 / scale} y={(displayed.y + displayed.height) * height - 10 / scale}
          width={20 / scale} height={20 / scale} style={{ cursor: "nwse-resize" }} onPointerDown={(e) => chosen && down(e, chosen, true)} />
      </g>}
    </svg>
    {active && controls && createPortal(toolbar, controls)}
    {active && pdfFile && createPortal(<PdfImageDialog key={pdfDraft!.id} file={pdfFile} onClose={() => setPdfDraft(null)}
      onInsert={(image) => { insert(image); setPdfDraft(null); }} />, document.body)}
    {active && chosen && crop && createPortal(<ImageCropDialog crop={crop} onCrop={setCrop} onClose={() => setCrop(null)}
      preview={<svg className="w-full h-40 my-3 bg-base-200" viewBox={`0 0 ${width} ${height}`} aria-label="切り抜きのプレビュー">
        <Raster asset={images!.assets[chosen.assetId]} image={cropImage(chosen, crop, images!.assets[chosen.assetId], width, height)} width={width} height={height} />
      </svg>}
      onApply={() => { replace(cropImage(chosen, crop, images!.assets[chosen.assetId], width, height)); setCrop(null); }} />, document.body)}
  </>;
}
