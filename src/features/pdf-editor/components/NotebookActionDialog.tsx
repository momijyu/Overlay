"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { canMoveItem } from "../noteDrag";
import { buildNoteTree, canDeleteEmptyFolder, folderChoices, hasFolderNameConflict } from "../noteTree";
import type { NoteFolder, NoteLibrary, SavedNoteSummary } from "../types";

export type NotebookAction =
  | { kind: "create-folder"; parentId: string | null }
  | { kind: "edit-note"; note: SavedNoteSummary }
  | { kind: "delete-note"; note: SavedNoteSummary }
  | { kind: "move-folder"; folder: NoteFolder }
  | { kind: "rename-folder"; folder: NoteFolder }
  | { kind: "delete-folder"; folder: NoteFolder };

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
  const initialParent = action.kind === "edit-note" || action.kind === "delete-note" ? action.note.folderId
    : action.kind === "create-folder" ? action.parentId : action.folder.parentId;
  const [name, setName] = useState(action.kind === "edit-note" ? action.note.title
    : action.kind === "rename-folder" ? action.folder.name : "");
  const [destination, setDestination] = useState(initialParent ?? "root");
  const choices = folderChoices(buildNoteTree(library.folders, library.notes));
  const movingItem = action.kind === "move-folder" ? { kind: "folder" as const, id: action.folder.id } : null;
  const deleting = action.kind === "delete-folder" || action.kind === "delete-note";
  const renaming = action.kind === "rename-folder";
  const showDestination = action.kind === "create-folder" || action.kind === "edit-note" || action.kind === "move-folder";
  const nameConflict = (action.kind === "create-folder" || renaming)
    && hasFolderNameConflict(name, renaming ? initialParent : destination === "root" ? null : destination,
      library, renaming ? action.folder.id : undefined);
  const canSubmit = action.kind === "delete-note" ? library.notes.some((note) => note.id === action.note.id)
    : action.kind === "delete-folder" ? canDeleteEmptyFolder(action.folder.id, library)
    : movingItem ? canMoveItem(movingItem, destination === "root" ? null : destination, library)
    : name.trim().length > 0 && name.trim().length <= (action.kind === "edit-note" ? 120 : 100)
      && !nameConflict && (!renaming || name.trim() !== action.folder.name);
  const hasDestination = !movingItem || canMoveItem(movingItem, null, library)
    || choices.some((folder) => canMoveItem(movingItem, folder.id, library));
  const title = action.kind === "create-folder" ? "フォルダ作成"
    : action.kind === "edit-note" ? "ノート名・保存先"
    : action.kind === "delete-note" ? "ノート削除"
    : renaming ? "フォルダ名変更" : deleting ? "空フォルダ削除" : "フォルダ移動";

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
          {action.kind === "delete-note" ? <p className="break-all">{action.note.title}</p>
            : action.kind === "move-folder" || action.kind === "delete-folder" ? <p className="break-all">{action.folder.name}</p> : (
            <div>
              <label className="label" htmlFor="notebook-name">{action.kind === "edit-note" ? "ノート名" : "フォルダ名"}</label>
              <input id="notebook-name" className="input w-full" required
                maxLength={action.kind === "edit-note" ? 120 : 100} value={name}
                disabled={busy} onChange={(event) => setName(event.target.value)} />
            </div>
          )}
          {showDestination && <div>
            <label className="label" htmlFor="notebook-destination">{action.kind === "create-folder" ? "作成先" : "移動先"}</label>
            <select id="notebook-destination" className="select w-full" value={destination}
              disabled={busy} onChange={(event) => setDestination(event.target.value)}>
              <option value="root" disabled={movingItem !== null && !canMoveItem(movingItem, null, library)}>
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
          </div>}
          {nameConflict && <p className="text-error" role="alert">同じ場所に同じ名前のフォルダがあります。</p>}
          {deleting && <p role="status" className="text-sm">
            {action.kind === "delete-note"
              ? canSubmit ? "このノートの元PDFと書き込みをブラウザ内から削除します。元に戻せません。開いている場合は未保存の変更も失われます。"
                : "削除するノートが見つかりません。一覧を更新してください。"
              : canSubmit ? "この空フォルダを削除します。元に戻せません。"
              : "空のフォルダだけ削除できます。中のノートやフォルダを先に移動してください。"}
          </p>}
          {error && <p className="text-error" role="alert">{error}</p>}
          <div className="modal-action mt-2">
            <button type="button" className="btn" disabled={busy} onClick={onClose}>キャンセル</button>
            <button type="submit" className={`btn ${deleting ? "btn-error" : "btn-primary"}`} disabled={busy || !canSubmit}>
              {busy ? deleting ? "削除中…" : "保存中…" : deleting ? "削除" : action.kind === "create-folder" ? "作成" : action.kind === "move-folder" ? "移動" : "変更"}
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
