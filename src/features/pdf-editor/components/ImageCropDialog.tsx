"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import type { NoteImage } from "../types";

const labels = { left: "左", top: "上", right: "右", bottom: "下" };
export function ImageCropDialog({ crop, onCrop, onClose, onApply, preview }: {
  crop: NoteImage["crop"]; onCrop(value: NoteImage["crop"]): void;
  onClose(): void; onApply(): void; preview: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  return <dialog ref={dialog} className="modal" aria-labelledby={heading}
    onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <div className="modal-box max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
      <h2 id={heading} className="font-bold">画像の切り抜き</h2>
      {preview}
      {(Object.keys(labels) as (keyof typeof labels)[]).map((edge) => {
        const horizontal = edge === "left" || edge === "right", start = edge === "left" || edge === "top";
        const offset = horizontal ? crop.x : crop.y, size = horizontal ? crop.width : crop.height;
        const amount = start ? offset : 1 - offset - size;
        return <label key={edge} className="flex min-h-11 items-center gap-3">
          {labels[edge]}
          <input aria-label={`${labels[edge]}を切り抜く割合`} type="range" min={0}
            max={Math.max(Math.round(amount * 100), Math.floor((start ? offset + size - .05 : 1 - offset - .05) * 100))}
            value={Math.round(amount * 100)} className="range range-xs" onChange={(e) => {
              const n = Number(e.target.value) / 100, next = { ...crop };
              if (horizontal) { next.x = start ? n : offset; next.width = start ? offset + size - n : 1 - offset - n; }
              else { next.y = start ? n : offset; next.height = start ? offset + size - n : 1 - offset - n; }
              onCrop(next);
            }} />
          <span className="w-12 shrink-0 text-right">{Math.round(amount * 100)}%</span>
        </label>;
      })}
      <div className="modal-action flex-wrap">
        <button type="button" className="btn min-h-11" onClick={onClose}>キャンセル</button>
        <button type="button" className="btn min-h-11" onClick={() => onCrop({ x: 0, y: 0, width: 1, height: 1 })}>元の範囲</button>
        <button type="button" className="btn btn-primary min-h-11" onClick={onApply}>適用</button>
      </div>
    </div>
    <form method="dialog" className="modal-backdrop" onSubmit={(e) => { e.preventDefault(); onClose(); }}>
      <button type="submit" aria-label="閉じる">閉じる</button>
    </form>
  </dialog>;
}
