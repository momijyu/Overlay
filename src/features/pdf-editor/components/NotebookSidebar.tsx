"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

import { createNoteFolder, FOLDER_SETUP_MESSAGE, loadNoteLibrary, moveNoteFolder, moveSavedNote, organizeNote } from "../noteFolders";
import { canMoveItem, NOTE_DRAG_TYPE, readNoteDrag, type NoteDragItem } from "../noteDrag";
import { buildNoteTree, type NoteTree } from "../noteTree";
import type { NoteLibrary, SavedNoteSummary } from "../types";
import { NotebookActionDialog, type NotebookAction } from "./NotebookActionDialog";
import { NotebookTree } from "./NotebookTree";

type SidebarProps = {
  refreshVersion: number;
  currentNoteId: string | null;
  disabled: boolean;
  onOpen: (note: SavedNoteSummary) => void;
  onRenamed: (id: string, title: string) => void;
  onMutationChange: (busy: boolean) => void;
};

const emptyLibrary: NoteLibrary = { notes: [], folders: [], foldersEnabled: true };

export function NotebookSidebar(props: SidebarProps) {
  const [retry, setRetry] = useState(0);
  const requestKey = `${props.refreshVersion}:${retry}`;
  const [result, setResult] = useState<{
    key: string;
    library: NoteLibrary;
    tree: NoteTree;
    error: string | null;
  }>({ key: "", library: emptyLibrary, tree: { folders: [], notes: [] }, error: null });
  const [expanded, setExpanded] = useState(new Set<string>());
  const [action, setAction] = useState<NotebookAction | null>(null);
  const [selection, setSelection] = useState<NoteDragItem | "root" | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverFolder = useRef<string | null>(null);
  const [dragging, setDragging] = useState<NoteDragItem | null>(null);
  const dragRef = useRef<NoteDragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveMessage, setMoveMessage] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const mutationRef = useRef(false);
  const mountedRef = useRef(false);
  const isLoading = result.key !== requestKey;
  const selected = selection === "root" ? null : selection ?? (
    props.currentNoteId ? { kind: "note" as const, id: props.currentNoteId } : null
  );
  const selectedNote = selected?.kind === "note" ? result.library.notes.find((note) => note.id === selected.id) : undefined;
  const selectedFolder = selected?.kind === "folder" ? result.library.folders.find((folder) => folder.id === selected.id) : undefined;
  const unavailable = props.disabled || isMutating || isLoading || result.error !== null;
  const canOrganize = !unavailable && result.library.foldersEnabled;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const library = await loadNoteLibrary();
        const tree = buildNoteTree(library.folders, library.notes);
        if (active) setResult({ key: requestKey, library, tree, error: null });
      } catch (error) {
        if (active) {
          setResult({
            key: requestKey, library: emptyLibrary, tree: { folders: [], notes: [] },
            error: error instanceof Error ? error.message : "ノートを読み込めませんでした。",
          });
        }
      }
    }
    void refresh();
    return () => { active = false; };
  }, [requestKey]);

  function expandParents(folderId: string | null, newFolderId?: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (newFolderId) next.add(newFolderId);
      let id = folderId;
      const visited = new Set<string>();
      while (id && !visited.has(id)) {
        visited.add(id);
        next.add(id);
        id = result.library.folders.find((folder) => folder.id === id)?.parentId ?? null;
      }
      return next;
    });
  }

  function beginAction(next: NotebookAction) {
    if (menuRef.current) menuRef.current.open = false;
    endDrag();
    setMoveError(null);
    setMoveMessage(null);
    setAction(next);
  }

  async function handleSubmit(name: string, folderId: string | null) {
    if (unavailable || mutationRef.current || !action) return;
    if (action.kind === "move-folder") {
      if (await handleMove({ kind: "folder", id: action.folder.id }, folderId)) setAction(null);
      return;
    }
    mutationRef.current = true;
    setIsMutating(true);
    props.onMutationChange(true);
    setMoveError(null);
    try {
      if (action.kind === "create-folder") {
        const id = await createNoteFolder(name, folderId);
        if (!mountedRef.current) return;
        expandParents(folderId, id);
        setSelection({ kind: "folder", id });
      } else {
        await organizeNote(action.note.id, name, folderId);
        if (!mountedRef.current) return;
        props.onRenamed(action.note.id, name.trim());
        expandParents(folderId);
      }
      setAction(null);
      setRetry((value) => value + 1);
    } catch (error) {
      if (mountedRef.current) {
        setMoveError(error instanceof Error ? error.message : "変更を保存できませんでした。");
      }
    } finally {
      mutationRef.current = false;
      if (mountedRef.current) {
        setIsMutating(false);
        props.onMutationChange(false);
      }
    }
  }

  function clearHover() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    hoverFolder.current = null;
  }

  function endDrag() {
    clearHover();
    dragRef.current = null;
    setDragging(null);
    setDropTarget(null);
  }

  function startDrag(event: DragEvent<HTMLElement>, item: NoteDragItem) {
    if (unavailable || action !== null || !result.library.foldersEnabled || mutationRef.current) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(NOTE_DRAG_TYPE, JSON.stringify(item));
    event.dataTransfer.setData("text/plain", item.id);
    dragRef.current = item;
    setSelection(item);
    setDragging(item);
    setMoveError(null);
    setMoveMessage(null);
  }

  function dragOver(event: DragEvent<HTMLElement>, folderId: string | null) {
    event.stopPropagation();
    const item = dragRef.current;
    const canMove = !!item && canMoveItem(item, folderId, result.library);
    const sourceParent = item?.kind === "folder"
      ? result.library.folders.find((folder) => folder.id === item.id)?.parentId
      : result.library.notes.find((note) => note.id === item?.id)?.folderId;
    // 現在の親も開けるようにして、その中の子フォルダを移動先として選べるようにする。
    if (!unavailable && !action && item && folderId && !expanded.has(folderId)
      && (canMove || sourceParent === folderId)) {
      if (hoverFolder.current !== folderId) {
        clearHover();
        hoverFolder.current = folderId;
        hoverTimer.current = setTimeout(() => {
          if (mountedRef.current && dragRef.current) {
            setExpanded((previous) => new Set(previous).add(folderId));
          }
          clearHover();
        }, 600);
      }
    } else clearHover();
    if (unavailable || action !== null || !item || !canMove) {
      event.dataTransfer.dropEffect = "none";
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(folderId ?? "root");
  }

  function dragLeave(event: DragEvent<HTMLElement>) {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
      clearHover();
      setDropTarget(null);
    }
  }

  function drop(event: DragEvent<HTMLElement>, folderId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const item = readNoteDrag(event.dataTransfer.getData(NOTE_DRAG_TYPE));
    const internalItem = dragRef.current;
    endDrag();
    // 外から落とされたファイル・文字列や、別タブのドラッグでは更新しない。
    if (!item || item.id !== internalItem?.id || item.kind !== internalItem.kind || action !== null) return;
    void handleMove(item, folderId);
  }

  async function handleMove(item: NoteDragItem, folderId: string | null): Promise<boolean> {
    if (unavailable || mutationRef.current) return false;
    if (!canMoveItem(item, folderId, result.library)) {
      setMoveError("移動先を変更してください。自分自身や子フォルダの中へは移動できません。");
      return false;
    }
    mutationRef.current = true;
    setIsMutating(true);
    props.onMutationChange(true);
    setMoveError(null);
    setMoveMessage("移動中…");
    try {
      if (item.kind === "note") await moveSavedNote(item.id, folderId);
      else await moveNoteFolder(item.id, folderId);
      if (!mountedRef.current) return false;
      expandParents(folderId, item.kind === "folder" ? item.id : undefined);
      setSelection(item);
      setRetry((value) => value + 1);
      setMoveMessage("移動しました。");
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setMoveMessage(null);
        setMoveError(error instanceof Error ? error.message : "移動できませんでした。");
      }
      return false;
    } finally {
      mutationRef.current = false;
      if (mountedRef.current) {
        setIsMutating(false);
        props.onMutationChange(false);
      }
    }
  }

  return (
    <nav aria-labelledby="notebook-heading" className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="notebook-heading" className="font-semibold">ノート</h2>
          <button type="button" className="btn btn-sm" disabled={props.disabled || isMutating || isLoading}
            onClick={() => setRetry((value) => value + 1)}>更新</button>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm" disabled={!canOrganize}
            onClick={() => beginAction({
              kind: "create-folder", parentId: selectedFolder?.id ?? selectedNote?.folderId ?? null,
            })}>フォルダ作成</button>
          <details ref={menuRef} className="dropdown">
            <summary className={`btn btn-sm ${!canOrganize || (!selectedNote && !selectedFolder) ? "btn-disabled" : ""}`}
              aria-disabled={!canOrganize || (!selectedNote && !selectedFolder)}
              tabIndex={!canOrganize || (!selectedNote && !selectedFolder) ? -1 : 0}
              onClick={(event) => {
                if (!canOrganize || (!selectedNote && !selectedFolder)) event.preventDefault();
              }}>操作</summary>
            <ul className="menu dropdown-content z-10 mt-2 w-44 rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
              {selectedNote && <li><button type="button" disabled={!canOrganize}
                onClick={() => beginAction({ kind: "edit-note", note: selectedNote })}>名前・保存先</button></li>}
              {selectedFolder && <li><button type="button" disabled={!canOrganize}
                onClick={() => beginAction({ kind: "move-folder", folder: selectedFolder })}>移動</button></li>}
            </ul>
          </details>
        </div>
        {moveMessage && <p role="status" className="text-sm">{moveMessage}</p>}
        {moveError && !action && <p role="alert" className="text-error">{moveError}</p>}
        {isLoading ? <p role="status">読み込み中…</p>
          : result.error ? <p role="alert" className="text-error">{result.error}</p>
          : (
            <>
              {!result.library.foldersEnabled && <p role="status">{FOLDER_SETUP_MESSAGE}</p>}
              {result.library.foldersEnabled && (
                <button type="button" disabled={unavailable}
                  className={`btn btn-sm btn-ghost w-full justify-start ${selection === "root" ? "bg-base-200" : ""} ${dropTarget === "root" ? "outline-2 outline-primary bg-base-200" : ""}`}
                  aria-label="最上位"
                  onClick={() => setSelection("root")}
                  onDragOver={(event) => dragOver(event, null)}
                  onDragLeave={dragLeave}
                  onDrop={(event) => drop(event, null)}
                >最上位</button>
              )}
              {result.library.notes.length === 0 && result.library.folders.length === 0
                ? <p>ノートはありません。</p>
                : <ul className="menu menu-sm w-full max-h-[70vh] flex-nowrap overflow-auto p-0">
                  <NotebookTree tree={result.tree} expanded={expanded} currentNoteId={props.currentNoteId}
                    selected={selected} onSelect={(item) => {
                      // ノートを開く操作は実際の表示中IDに追従する。切り替えをキャンセルしても対象がずれない。
                      setSelection(item.kind === "note" ? null : item);
                    }}
                    disabled={unavailable} onOpen={props.onOpen}
                    dragEnabled={canOrganize && !action}
                    dragging={dragging} dropTarget={dropTarget}
                    onDragStart={startDrag} onDragEnd={endDrag} onDragOver={dragOver}
                    onDragLeave={dragLeave} onDrop={drop}
                    onToggle={(id, open) => setExpanded((previous) => {
                      if (previous.has(id) === open) return previous;
                      const next = new Set(previous);
                      if (open) next.add(id); else next.delete(id);
                      return next;
                    })} />
                </ul>}
            </>
          )}
      </div>
      {action && <NotebookActionDialog action={action} library={result.library}
        busy={props.disabled || isMutating} error={moveError} onSubmit={handleSubmit}
        onClose={() => {
          if (!mutationRef.current) { setAction(null); setMoveError(null); }
        }} />}
    </nav>
  );
}
