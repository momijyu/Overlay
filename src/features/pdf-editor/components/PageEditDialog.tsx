"use client";

import { useEffect, useRef, useState } from "react";
import type { PageClearSelection } from "../strokeHistory";

export type PageEditKind = "delete-page" | "clear-page";
const labels = { strokes: "線（マーカー含む）", sticky: "付箋", text: "テキストボックス" };

export function PageEditDialog({ kind, pageNumber, counts, disabled, onClose, onConfirm }: {
  kind: PageEditKind; pageNumber: number; counts: Record<keyof PageClearSelection, number>;
  disabled: boolean; onClose: () => void; onConfirm: (selection: PageClearSelection) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selection, setSelection] = useState<PageClearSelection>({ strokes: true, sticky: true, text: true });
  const selectedCount = (Object.keys(labels) as (keyof PageClearSelection)[])
    .reduce((sum, kind) => sum + (selection[kind] ? counts[kind] : 0), 0);
  const blocked = disabled || kind === "clear-page" && selectedCount === 0;
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="page-edit-heading"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="modal-box flex max-h-[calc(100dvh-2rem)] max-w-md flex-col overflow-hidden rounded-box">
      <h3 id="page-edit-heading" className="mb-4 shrink-0 text-lg font-semibold">
        {kind === "delete-page" ? "ページを削除" : "書き込みを一括削除"}
      </h3>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
        event.preventDefault(); if (!blocked) onConfirm(selection);
      }}>
        <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain">
          <p>{pageNumber}ページ{kind === "delete-page" ? "と、このページの書き込みを削除します。" : "の削除する種類を選択してください。"}</p>
          {kind === "clear-page" && <fieldset className="space-y-2" disabled={disabled}>
            <legend className="sr-only">削除する書き込み</legend>
            {(Object.keys(labels) as (keyof PageClearSelection)[]).map((kind) => <label key={kind} className="flex min-h-11 cursor-pointer items-center gap-3">
              <input type="checkbox" className="checkbox checkbox-sm" checked={selection[kind] && counts[kind] > 0}
                disabled={disabled || counts[kind] === 0} onChange={(event) => setSelection({ ...selection, [kind]: event.target.checked })} />
              <span>{labels[kind]}：{counts[kind]}件</span>
            </label>)}
          </fieldset>}
          {kind === "clear-page" && <p className="text-sm">選択した書き込み{selectedCount}件を削除します。元PDFの内容は消えません。</p>}
          <p className="text-sm text-base-content/70">元に戻すで取り消せます。</p>
        </div>
        <div className="modal-action mt-4 shrink-0 flex-wrap">
          <button type="button" className="btn min-h-11" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn btn-error min-h-11" disabled={blocked}>削除</button>
        </div>
      </form>
    </div>
    <form method="dialog" className="modal-backdrop" onSubmit={(event) => { event.preventDefault(); onClose(); }}>
      <button type="submit" aria-label="閉じる">閉じる</button>
    </form>
  </dialog>;
}
