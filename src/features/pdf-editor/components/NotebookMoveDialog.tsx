"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { canMoveItems, type NoteDragItem } from "../noteDrag";
import { buildNoteTree, folderChoices } from "../noteTree";
import type { NoteLibrary } from "../types";

export function NotebookMoveDialog({ items, library, busy, error, onClose, onSubmit }: {
  items: NoteDragItem[]; library: NoteLibrary; busy: boolean; error: string | null;
  onClose: () => void; onSubmit: (folderId: string | null) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [destination, setDestination] = useState("");
  const parentId = destination === "root" ? null : destination;
  const valid = destination !== "" && canMoveItems(items, parentId, library);
  const choices = [{ id: "root", path: "一番上" }, ...folderChoices(buildNoteTree(library.folders, library.notes))];
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && valid) await onSubmit(parentId);
  }
  return <dialog ref={ref} className="modal" aria-labelledby="notebook-move-heading"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-box max-w-md rounded-box">
      <h3 id="notebook-move-heading" className="mb-4 text-lg font-semibold">選択した項目を移動</h3>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <p>{items.length}件選択中</p>
        <p className="text-sm">選んだフォルダの中身は、そのまま一緒に移動します。</p>
        <label className="label" htmlFor="notebook-bulk-destination">移動先</label>
        <select id="notebook-bulk-destination" className="select w-full" value={destination}
          disabled={busy} onChange={(event) => setDestination(event.target.value)}>
          <option value="" disabled>移動先を選択</option>
          {choices.map((choice) => <option key={choice.id} value={choice.id}
            disabled={!canMoveItems(items, choice.id === "root" ? null : choice.id, library)}>{choice.path}</option>)}
        </select>
        {!choices.some((choice) => canMoveItems(items, choice.id === "root" ? null : choice.id, library)) &&
          <p role="status" className="text-sm">移動先がありません。同名フォルダや選択範囲を確認してください。</p>}
        {error && <p role="alert" className="text-error">{error}</p>}
        <div className="modal-action mt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !valid}>{busy ? "移動中…" : "移動"}</button>
        </div>
      </form>
    </div>
    <form method="dialog" className="modal-backdrop" onSubmit={(event) => {
      event.preventDefault(); if (!busy) onClose();
    }}><button type="submit" disabled={busy} aria-label="閉じる">閉じる</button></form>
  </dialog>;
}
