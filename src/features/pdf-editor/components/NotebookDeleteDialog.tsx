"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { noteItemKey, type NoteDragItem } from "../noteDrag";
import { checkedDeletion } from "../noteSelection";
import { buildNoteTree, folderChoices } from "../noteTree";
import type { NoteLibrary } from "../types";

export function NotebookDeleteDialog({ items, library, busy, error, onClose, onSubmit }: {
  items: NoteDragItem[]; library: NoteLibrary; busy: boolean; error: string | null;
  onClose: () => void; onSubmit: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  let validationError: string | null = null;
  try { checkedDeletion(items, library); }
  catch (failure) { validationError = failure instanceof Error ? failure.message : "削除対象を確認できません。"; }
  const folders = folderChoices(buildNoteTree(library.folders, library.notes));
  const noteCount = items.filter((item) => item.kind === "note").length;
  const folderCount = items.filter((item) => item.kind === "folder").length;
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && !validationError) await onSubmit();
  }
  return <dialog ref={ref} className="modal" aria-labelledby="notebook-delete-heading"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-box max-w-md rounded-box">
      <h3 id="notebook-delete-heading" className="mb-4 text-lg font-semibold">選択した項目を削除</h3>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <p>ノート{noteCount}件・フォルダ{folderCount}件を削除します。</p>
        <ul aria-label="削除する項目" className="max-h-48 overflow-auto rounded-box border border-base-content/25 p-3 text-sm">
          {items.map((item) => {
            const note = item.kind === "note" ? library.notes.find((note) => note.id === item.id) : undefined;
            const path = item.kind === "folder" ? folders.find((folder) => folder.id === item.id)?.path
              : `${folders.find((folder) => folder.id === note?.folderId)?.path ?? "一番上"} / ${note?.title ?? "不明なノート"}`;
            return <li key={noteItemKey(item)} className="break-all py-1">{item.kind === "folder" ? "フォルダ：" : "ノート："}{path ?? "不明なフォルダ"}</li>;
          })}
        </ul>
        <p className="text-xs leading-relaxed text-red-600 dark:text-red-400" data-bulk-delete-warning>※ 表示したノートの元PDF・書き込みとフォルダを、このブラウザから削除します。元に戻せません。開いているノートが含まれる場合は未保存の変更も失われます。</p>
        {(error || validationError) && <p role="alert" className="text-error">{error || validationError}</p>}
        <div className="modal-action mt-2">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn btn-error" disabled={busy || !!validationError}>{busy ? "削除中…" : "削除"}</button>
        </div>
      </form>
    </div>
    <form method="dialog" className="modal-backdrop" onSubmit={(event) => {
      event.preventDefault(); if (!busy) onClose();
    }}><button type="submit" disabled={busy} aria-label="閉じる">閉じる</button></form>
  </dialog>;
}
