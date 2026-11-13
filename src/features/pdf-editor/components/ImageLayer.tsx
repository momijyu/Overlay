"use client";

import { useEffect, useLayoutEffect, useId, useRef, useState, type PointerEvent } from "react";
import { ImageCropDialog } from "./ImageCropDialog";
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
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteImage | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<NoteImage["crop"] | null>(null);
  const pending = useRef<{ pointer: number; startX: number; startY: number; image: NoteImage; resize: boolean } | null>(null);
  const latest = useRef<NoteImage | null>(null);
  const generation = useRef({ ticket: 0 });
  useLayoutEffect(() => { const current = generation.current; current.ticket++; return () => { current.ticket++; }; }, [scope, pageId, active, images]);
  function preview(value: NoteImage | null) { latest.current = value; setDraft(value); }
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
  async function add(file?: File) {
    if (!file || busy || disabled) return;
    const ticket = generation.current.ticket;
    setBusy(true); setError(null);
    try {
      const { id, asset } = await importImage(file);
      if (ticket !== generation.current.ticket) return;
      const factor = Math.min(width * .6 / asset.width, height * .6 / asset.height);
      const image: NoteImage = { id: crypto.randomUUID(), assetId: id, x: .1, y: .1,
        width: asset.width * factor / width, height: asset.height * factor / height, rotation: 0, crop: { x: 0, y: 0, width: 1, height: 1 } };
      commit([...source, image], { ...images?.assets, [id]: asset }); setSelected(image.id);
    } catch (e) { setError(e instanceof Error ? e.message : "画像を追加できませんでした。"); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  function down(e: PointerEvent<SVGElement>, image: NoteImage, resize = false) {
    if (disabled || !active || busy || interaction.blocked || e.button !== 0) return;
    e.preventDefault(); setCrop(null); setSelected(image.id); preview(image);
    pending.current = { pointer: e.pointerId, startX: e.clientX, startY: e.clientY, image, resize };
    svg.current?.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    const p = pending.current;
    if (!p || p.pointer !== e.pointerId || interaction.blocked) return;
    const dx = (e.clientX - p.startX) / (width * scale), dy = (e.clientY - p.startY) / (height * scale);
    if (p.resize) {
      preview(resizeImage(p.image, dx, dy));
    } else preview({ ...p.image, x: Math.max(0, Math.min(1 - p.image.width, p.image.x + dx)), y: Math.max(0, Math.min(1 - p.image.height, p.image.y + dy)) });
  }
  function finish(e: PointerEvent<SVGSVGElement>, cancel = false) {
    const p = pending.current; if (!p || p.pointer !== e.pointerId) return;
    pending.current = null;
    const next = latest.current; setDraft(null);
    if (!cancel && !interaction.blocked && next && (next.x !== p.image.x || next.y !== p.image.y || next.width !== p.image.width || next.height !== p.image.height)) replace(next);
  }
  const displayed = draft ?? chosen;
  function reorder(direction: number) {
    if (!chosen) return;
    const index = source.indexOf(chosen), next = index + direction;
    if (next < 0 || next >= source.length) return;
    const list = [...source]; [list[index], list[next]] = [list[next], list[index]]; commit(list);
  }
  const toolbar = <div className="flex items-center gap-2" aria-label="画像の操作">
    <input ref={input} type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" className="hidden" aria-label="挿入する画像" onChange={(e) => void add(e.target.files?.[0])} disabled={disabled || busy} />
    <button className="btn btn-sm" type="button" disabled={disabled || busy} onClick={() => input.current?.click()}>{busy ? "読み込み中…" : "画像を追加"}</button>
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
        const shown = draft?.id === image.id ? draft : image, asset = images?.assets[image.assetId];
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
    {active && chosen && crop && createPortal(<ImageCropDialog crop={crop} onCrop={setCrop} onClose={() => setCrop(null)}
      preview={<svg className="w-full h-40 my-3 bg-base-200" viewBox={`0 0 ${width} ${height}`} aria-label="切り抜きのプレビュー">
        <Raster asset={images!.assets[chosen.assetId]} image={cropImage(chosen, crop, images!.assets[chosen.assetId], width, height)} width={width} height={height} />
      </svg>}
      onApply={() => { replace(cropImage(chosen, crop, images!.assets[chosen.assetId], width, height)); setCrop(null); }} />, document.body)}
  </>;
}
