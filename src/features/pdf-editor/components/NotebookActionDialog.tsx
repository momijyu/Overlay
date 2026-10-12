"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { canMoveItem } from "../noteDrag";
import { buildNoteTree, folderChoices } from "../noteTree";
import type { NoteFolder, NoteLibrary, SavedNoteSummary } from "../types";

export type NotebookAction =
  | { kind: "create-folder"; parentId: string | null }
  | { kind: "edit-note"; note: SavedNoteSummary }
  | { kind: "move-folder"; folder: NoteFolder };

type DialogProps = {
  action: NotebookAction;
  library: NoteLibrary;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string, folderId: string | null) => Promise<void>;
};

export function NotebookActionDialog({ action, library, busy, error, onClose, onSubmit }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialParent = action.kind === "edit-note" ? action.note.folderId
    : action.kind === "move-folder" ? action.folder.parentId : action.parentId;
  const [name, setName] = useState(action.kind === "edit-note" ? action.note.title : "");
  const [destination, setDestination] = useState(initialParent ?? "root");
  const choices = folderChoices(buildNoteTree(library.folders, library.notes));
  const movingItem = action.kind === "move-folder" ? { kind: "folder" as const, id: action.folder.id } : null;
  const canSubmit = movingItem ? canMoveItem(movingItem, destination === "root" ? null : destination, library)
    : name.trim().length > 0;
  const hasDestination = !movingItem || canMoveItem(movingItem, null, library)
    || choices.some((folder) => canMoveItem(movingItem, folder.id, library));
  const title = action.kind === "create-folder" ? "フォルダ作成"
    : action.kind === "edit-note" ? "ノート名・保存先" : "フォルダ移動";

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && canSubmit) await onSubmit(name.trim(), destination === "root" ? null : destination);
  }

  return (
    <dialog ref={dialogRef} className="modal" aria-labelledby="notebook-action-heading"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="modal-box max-w-md">
        <h3 id="notebook-action-heading" className="mb-4 text-lg font-semibold">{title}</h3>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
          {action.kind === "move-folder" ? <p className="break-all">{action.folder.name}</p> : (
            <div>
              <label className="label" htmlFor="notebook-name">{action.kind === "create-folder" ? "フォルダ名" : "ノート名"}</label>
              <input id="notebook-name" className="input w-full" required
                maxLength={action.kind === "create-folder" ? 100 : 120} value={name}
                disabled={busy} onChange={(event) => setName(event.target.value)} />
            </div>
          )}
          <div>
            <label className="label" htmlFor="notebook-destination">{action.kind === "create-folder" ? "作成先" : "移動先"}</label>
            <select id="notebook-destination" className="select w-full" value={destination}
              disabled={busy} onChange={(event) => setDestination(event.target.value)}>
              <option value="root" disabled={movingItem !== null && initialParent === null}>
                最上位{movingItem && initialParent === null ? "（現在）" : ""}
              </option>
              {choices.filter((folder) => !movingItem || folder.id === initialParent || canMoveItem(movingItem, folder.id, library))
                .map((folder) => (
                  <option key={folder.id} value={folder.id} disabled={movingItem !== null && folder.id === initialParent}>
                    {folder.path}{movingItem && folder.id === initialParent ? "（現在）" : ""}
                  </option>
                ))}
            </select>
            {movingItem && !canSubmit && <p className="mt-2 text-sm" role="status">
              {hasDestination ? "別の移動先を選択してください。" : "移動先がありません。先に別のフォルダを作成してください。"}
            </p>}
          </div>
          {error && <p className="text-error" role="alert">{error}</p>}
          <div className="modal-action mt-2">
            <button type="button" className="btn" disabled={busy} onClick={onClose}>キャンセル</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !canSubmit}>
              {busy ? "保存中…" : action.kind === "create-folder" ? "作成" : action.kind === "move-folder" ? "移動" : "変更"}
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" className="modal-backdrop" onSubmit={(event) => {
        event.preventDefault(); if (!busy) onClose();
      }}><button type="submit" disabled={busy} aria-label="閉じる">閉じる</button></form>
    </dialog>
  );
}
