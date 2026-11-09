"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

import { getLibraryScope } from "../driveLibraryLocal";
import { subscribeLibraryChanged } from "../driveLibraryEvents";
import { createNoteFolder, deleteEmptyNoteFolder, loadNoteLibrary, moveNoteFolder, moveSavedNote, moveSavedItems, organizeNote, renameNoteFolder } from "../localNotes";
import { canMoveItem, canMoveItems, libraryItems, noteItemKey, NOTE_DRAG_TYPE, readNoteDrag, type NoteDragItem } from "../noteDrag";
import { attachNotebookTouchDrag, notebookDropAt } from "../notebookTouchDrag";
import { toggleNotebookSelection } from "../noteSelection";
import { buildNoteTree, canDeleteEmptyFolder, hasFolderNameConflict, type NoteTree } from "../noteTree";
import type { NoteLibrary, SavedNoteSummary } from "../types";
import { NotebookActionDialog, type NotebookAction } from "./NotebookActionDialog";
import { NotebookTree } from "./NotebookTree";
import { NotebookMoveDialog } from "./NotebookMoveDialog";
import { NotebookDeleteDialog } from "./NotebookDeleteDialog";
import { StickyNotesPanel } from "./StickyNotesPanel";
import type { CurrentStickyOutline } from "../stickyOutline";
import { readNoteDriveStatuses, type NoteDriveStatus } from "../noteDriveStatus";
import { subscribeDriveQueue } from "../driveQueueEvents";
import { getGoogleDriveSession } from "../googleDriveSession";

function connectionKey(connection: ReturnType<ReturnType<typeof getGoogleDriveSession>["getConnection"]>) {
  return connection?.root ? JSON.stringify([connection.account.id, connection.root.id]) : null;
}

type SidebarProps = {
  refreshVersion: number;
  onDestinationChange?: (id: string | null) => void;
  currentNoteId: string | null;
  currentNoteSaveState?: "pending" | "warning";
  visible?: boolean;
  disabled: boolean;
  onOpen: (note: SavedNoteSummary) => void;
  onRenamed: (id: string, title: string) => void;
  onDelete: (id: string) => Promise<void>;
  onDeleteItems: (items: NoteDragItem[]) => Promise<void>;
  onMutationChange: (busy: boolean) => void;
  onBackup?: (item: NoteDragItem) => void;
  onBackupItems?: (items: NoteDragItem[]) => void;
  onSaveToDrive?: (noteId: string) => void;
  onSaveItemsToDrive?: (notes: SavedNoteSummary[]) => void;
  currentStickyOutline?: CurrentStickyOutline;
  currentPageId?: number;
  onOpenSticky?: (note: SavedNoteSummary | null, pageId: number, textId: string, sourceId?: string) => void;
};

const emptyLibrary: NoteLibrary = { notes: [], folders: [], foldersEnabled: true };

export function NotebookSidebar(props: SidebarProps) {
  const [retry, setRetry] = useState(0);
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [checkedItems, setCheckedItems] = useState(new Set<string>());
  const [bulkMoving, setBulkMoving] = useState(false);
  const [touchPreview, setTouchPreview] = useState<{ x: number; y: number; name: string } | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const touchCallbacks = useRef<Parameters<typeof attachNotebookTouchDrag>[1] | null>(null);
  const touchFrame = useRef<number | null>(null);
  const [deleting, setDeleting] = useState<{ items: NoteDragItem[]; library: NoteLibrary } | null>(null);
  const [driveLinked, setDriveLinked] = useState(false);
  const [driveStatuses, setDriveStatuses] = useState<Record<string, NoteDriveStatus>>({});
  const [driveStatusError, setDriveStatusError] = useState<string | null>(null);
  const [connectedScope, setConnectedScope] = useState<string | null>(null);
  const requestKey = `${props.refreshVersion}:${retry}${connectedScope ? `:${connectedScope}` : ""}`;
  const { onDestinationChange } = props;
  const isLoading = result.key !== requestKey;
  // 接続が切り替わった直後も、前の取得結果や付箋を読み込み中の画面へ残さない。
  const library = isLoading ? emptyLibrary : result.library;
  const selected = selection === "root" ? null : selection ?? (
    props.currentNoteId ? { kind: "note" as const, id: props.currentNoteId } : null
  );
  const selectedNote = selected?.kind === "note" ? library.notes.find((note) => note.id === selected.id) : undefined;
  const selectedFolder = selected?.kind === "folder" ? library.folders.find((folder) => folder.id === selected.id) : undefined;
  const unavailable = props.disabled || isMutating || isLoading || result.error !== null;
  const canOrganize = !unavailable && library.foldersEnabled;
  const allItems = libraryItems(library);
  const checked = allItems.filter((item) => checkedItems.has(noteItemKey(item)));
  const checkedNotes = library.notes.filter((note) => checkedItems.has(`note:${note.id}`));

  useEffect(() => subscribeLibraryChanged(() => setRetry((value) => value + 1)), []);

  useEffect(() => {
    const session = getGoogleDriveSession();
    const changed = () => setConnectedScope(connectionKey(session.getConnection()));
    const unsubscribe = session.subscribe(changed);
    changed();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (props.visible === false) return;
    let active = true; let reading = false; let again = false;
    async function refresh() {
      if (!active) return;
      if (reading) { again = true; return; }
      reading = true;
      try {
        const statuses = await readNoteDriveStatuses();
        if (active) {
          setDriveStatuses((previous) => JSON.stringify(previous) === JSON.stringify(statuses) ? previous : statuses);
          setDriveStatusError(null);
        }
      } catch {
        if (active) { setDriveStatuses({}); setDriveStatusError("Driveの保存状態を確認できませんでした。"); }
      } finally {
        reading = false;
        if (again && active) { again = false; void refresh(); }
      }
    }
    const unsubscribeQueue = subscribeDriveQueue(() => { void refresh(); });
    const unsubscribeLibrary = subscribeLibraryChanged(() => { void refresh(); });
    const interval = setInterval(() => { void refresh(); }, 5000);
    void refresh();
    return () => { active = false; clearInterval(interval); unsubscribeQueue(); unsubscribeLibrary(); };
  }, [props.visible]);

  const shownDriveStatuses = props.currentNoteId && props.currentNoteSaveState && driveStatuses[props.currentNoteId]
    ? { ...driveStatuses, [props.currentNoteId]: driveStatuses[props.currentNoteId] === "warning" ? "warning" as const : props.currentNoteSaveState }
    : driveStatuses;

  useEffect(() => { onDestinationChange?.(selectedFolder?.id ?? selectedNote?.folderId ?? null); }, [onDestinationChange, selectedFolder?.id, selectedNote?.folderId]);

  // listenerは毎描画で張り替えず、最新の一覧・展開状態だけを参照する。
  useEffect(() => {
    touchCallbacks.current = {
      onStart(item, point) {
        if (unavailable || action || selectionMode || bulkMoving) return;
        dragRef.current = item;
        setDragging(item);
        setSelection(item);
        setMoveError(null);
        setMoveMessage(null);
        const name = item.kind === "folder"
          ? library.folders.find((folder) => folder.id === item.id)?.name
          : library.notes.find((note) => note.id === item.id)?.title;
        setTouchPreview({ ...point, name: name ?? "" });
        touchCallbacks.current?.onMove(point);
      },
      onMove(point) {
        if (!dragRef.current || !navRef.current) return;
        setTouchPreview((previous) => previous ? { ...previous, ...point } : null);
        const destination = notebookDropAt(navRef.current, point.x, point.y);
        if (destination === undefined) { clearHover(); setDropTarget(null); }
        else updateDropTarget(destination);
        // 長い一覧は指を端に置いて送れる。指を止めていてもスクロールを続ける。
        if (touchFrame.current !== null) cancelAnimationFrame(touchFrame.current);
        const list = navRef.current.querySelector<HTMLElement>(".notebook-tree");
        const bounds = list?.getBoundingClientRect();
        if (!list || !bounds || point.x < bounds.left || point.x > bounds.right
          || point.y < bounds.top - 20 || point.y > bounds.bottom + 20) return;
        const delta = point.y < bounds.top + 36 ? -7 : point.y > bounds.bottom - 36 ? 7 : 0;
        if (delta) touchFrame.current = requestAnimationFrame(() => {
          touchFrame.current = null;
          const previous = list.scrollTop;
          list.scrollTop += delta;
          if (list.scrollTop !== previous) touchCallbacks.current?.onMove(point);
        });
      },
      onDrop(point) {
        const item = dragRef.current;
        const destination = navRef.current ? notebookDropAt(navRef.current, point.x, point.y) : undefined;
        endDrag();
        if (item && destination !== undefined && canMoveItem(item, destination, library)) void handleMove(item, destination);
      },
      onCancel: endDrag,
    };
  });

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !canOrganize || action || bulkMoving || selectionMode) return;
    return attachNotebookTouchDrag(nav, {
      onStart: (item, point) => touchCallbacks.current?.onStart(item, point),
      onMove: (point) => touchCallbacks.current?.onMove(point),
      onDrop: (point) => touchCallbacks.current?.onDrop(point),
      onCancel: () => touchCallbacks.current?.onCancel(),
    });
  }, [canOrganize, action, bulkMoving, selectionMode]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      if (touchFrame.current !== null) cancelAnimationFrame(touchFrame.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const linked = await getLibraryScope();
        const showCloud = !!linked && connectedScope === JSON.stringify([linked.accountId, linked.rootId]);
        const library = await loadNoteLibrary({ localOnly: !showCloud });
        if (active) setDriveLinked(!!linked);
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
  }, [requestKey, connectedScope]);

  useEffect(() => {
    if (moveMessage !== "移動しました。") return;
    const timer = setTimeout(() => setMoveMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [moveMessage]);

  function expandParents(folderId: string | null, newFolderId?: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (newFolderId) next.add(newFolderId);
      let id = folderId;
      const visited = new Set<string>();
      while (id && !visited.has(id)) {
        visited.add(id);
        next.add(id);
        id = library.folders.find((folder) => folder.id === id)?.parentId ?? null;
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
    // 確認画面の表示後も、APIを呼ぶ直前に表示中の一覧で検証する。
    if (action.kind === "delete-folder" && !canDeleteEmptyFolder(action.folder.id, library)) {
      setMoveError("空のフォルダだけ削除できます。");
      return;
    }
    if ((action.kind === "create-folder" || action.kind === "rename-folder")
      && hasFolderNameConflict(name, action.kind === "rename-folder" ? action.folder.parentId : folderId,
        library, action.kind === "rename-folder" ? action.folder.id : undefined)) {
      setMoveError("同じ場所に同じ名前のフォルダがあります。");
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
      } else if (action.kind === "rename-folder") {
        await renameNoteFolder(action.folder.id, name);
        if (!mountedRef.current) return;
      } else if (action.kind === "delete-folder") {
        await deleteEmptyNoteFolder(action.folder.id);
        if (!mountedRef.current) return;
        setSelection(action.folder.parentId ? { kind: "folder", id: action.folder.parentId } : "root");
        setExpanded((previous) => {
          const next = new Set(previous);
          next.delete(action.folder.id);
          return next;
        });
        setMoveMessage("空フォルダを削除しました。この操作は元に戻せません。");
      } else if (action.kind === "delete-note") {
        await props.onDelete(action.note.id);
        if (!mountedRef.current) return;
        setSelection(action.note.folderId ? { kind: "folder", id: action.note.folderId } : "root");
        setMoveMessage("ノートを削除しました。この操作は元に戻せません。");
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
    if (touchFrame.current !== null) cancelAnimationFrame(touchFrame.current);
    touchFrame.current = null;
    dragRef.current = null;
    setDragging(null);
    setDropTarget(null);
    setTouchPreview(null);
  }

  function startDrag(event: DragEvent<HTMLElement>, item: NoteDragItem) {
    if (unavailable || action !== null || selectionMode || bulkMoving || !library.foldersEnabled || mutationRef.current) {
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
    const valid = updateDropTarget(folderId);
    event.dataTransfer.dropEffect = valid ? "move" : "none";
    if (valid) event.preventDefault();
  }

  function updateDropTarget(folderId: string | null): boolean {
    const item = dragRef.current;
    const canMove = !!item && canMoveItem(item, folderId, library);
    const sourceParent = item?.kind === "folder"
      ? library.folders.find((folder) => folder.id === item.id)?.parentId
      : library.notes.find((note) => note.id === item?.id)?.folderId;
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
    if (unavailable || action !== null || selectionMode || bulkMoving || !item || !canMove) {
      setDropTarget(null);
      return false;
    }
    setDropTarget(folderId ?? "root");
    return true;
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
    if (!canMoveItem(item, folderId, library)) {
      const folder = item.kind === "folder" ? library.folders.find((folder) => folder.id === item.id) : undefined;
      setMoveError(folder && hasFolderNameConflict(folder.name, folderId, library, folder.id)
        ? "移動先に同じ名前のフォルダがあります。"
        : "移動先を変更してください。自分自身や子フォルダの中へは移動できません。");
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

  function toggleChecked(item: NoteDragItem) {
    if (unavailable) return;
    setCheckedItems((previous) => toggleNotebookSelection(previous, item, library));
  }

  async function deleteChecked() {
    if (props.disabled || mutationRef.current || !deleting) return;
    mutationRef.current = true;
    setIsMutating(true);
    props.onMutationChange(true);
    setMoveError(null);
    try {
      await props.onDeleteItems(deleting.items);
      if (!mountedRef.current) return;
      const deletedKeys = new Set(deleting.items.map(noteItemKey));
      setExpanded((previous) => new Set([...previous].filter((id) => !deletedKeys.has(`folder:${id}`))));
      setSelection("root");
      setDeleting(null);
      setSelectionMode(false);
      setCheckedItems(new Set());
      setRetry((value) => value + 1);
      setMoveMessage("選択した項目を削除しました。この操作は元に戻せません。");
    } catch (error) {
      if (mountedRef.current) setMoveError(error instanceof Error ? error.message : "削除できませんでした。");
    } finally {
      mutationRef.current = false;
      if (mountedRef.current) { setIsMutating(false); props.onMutationChange(false); }
    }
  }

  async function moveChecked(folderId: string | null) {
    if (unavailable || mutationRef.current || !canMoveItems(checked, folderId, library)) return;
    mutationRef.current = true;
    setIsMutating(true);
    props.onMutationChange(true);
    setMoveError(null);
    try {
      await moveSavedItems(checked, folderId);
      if (!mountedRef.current) return;
      expandParents(folderId);
      setBulkMoving(false);
      setSelectionMode(false);
      setCheckedItems(new Set());
      setRetry((value) => value + 1);
      setMoveMessage("移動しました。");
    } catch (error) {
      if (mountedRef.current) setMoveError(error instanceof Error ? error.message : "移動できませんでした。");
    } finally {
      mutationRef.current = false;
      if (mountedRef.current) { setIsMutating(false); props.onMutationChange(false); }
    }
  }

  return (
    <nav ref={navRef} aria-labelledby="notebook-heading" className="min-w-0">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="notebook-heading" className="font-semibold">ノート</h2>
          <button type="button" className="btn btn-sm" disabled={props.disabled || isMutating || isLoading}
            onClick={() => setRetry((value) => value + 1)}>更新</button>
        </div>
        <div className="relative flex min-w-0 gap-2" data-notebook-actions>
          {!selectionMode && <>
          <button type="button" className="btn btn-sm" disabled={!canOrganize}
            onClick={() => beginAction({
              kind: "create-folder", parentId: selectedFolder?.id ?? selectedNote?.folderId ?? null,
            })}>フォルダ作成</button>
          <details ref={menuRef} className="dropdown static">
            {/* summaryは常に開閉可能。処理中の制限は各メニュー項目で行う。 */}
            <summary className="btn btn-sm">操作</summary>
            {/* ボタンでなく操作行の左端を基準にし、狭い一覧の外へはみ出さない幅で開く。 */}
            <ul className="menu dropdown-content start-0 z-10 mt-2 w-full min-w-0 max-w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow-sm [&_button]:whitespace-normal [&_button]:break-words">
              {!selectedNote && !selectedFolder && <li><button type="button" disabled>
                ノートまたはフォルダを選択してください
              </button></li>}
              {props.onBackup && (selectedNote || selectedFolder) && <li><button type="button" disabled={unavailable}
                onClick={() => {
                  if (unavailable || !selected) return;
                  if (menuRef.current) menuRef.current.open = false;
                  endDrag();
                  props.onBackup?.(selected);
                }}>{selectedFolder ? "フォルダのバックアップ" : "ノートのバックアップ"}</button></li>}
              {selectedNote && <li><button type="button" disabled={!canOrganize}
                onClick={() => beginAction({ kind: "edit-note", note: selectedNote })}>名前・フォルダ</button></li>}
              {props.onSaveToDrive && selectedNote && <li><button type="button" disabled={unavailable}
                onClick={() => {
                  if (unavailable) return;
                  if (menuRef.current) menuRef.current.open = false;
                  props.onSaveToDrive?.(selectedNote.id);
                }}>Driveにバックアップ</button></li>}
              {selectedNote && <li><button type="button" className="text-error" disabled={!canOrganize}
                onClick={() => beginAction({ kind: "delete-note", note: selectedNote })}>ノート削除</button></li>}
              {selectedFolder && <li><button type="button" disabled={!canOrganize}
                onClick={() => beginAction({ kind: "move-folder", folder: selectedFolder })}>移動</button></li>}
              {selectedFolder && <li><button type="button" disabled={!canOrganize}
                onClick={() => beginAction({ kind: "rename-folder", folder: selectedFolder })}>名前変更</button></li>}
              {selectedFolder && <li><button type="button"
                disabled={!canOrganize || !canDeleteEmptyFolder(selectedFolder.id, library)}
                title={canDeleteEmptyFolder(selectedFolder.id, library) ? undefined : "空のフォルダだけ削除できます。"}
                onClick={() => beginAction({ kind: "delete-folder", folder: selectedFolder })}>空フォルダ削除</button></li>}
            </ul>
          </details>
          </>}
          <button type="button" className="btn btn-sm" disabled={!canOrganize || !!action || bulkMoving || !!deleting}
            aria-pressed={selectionMode} onClick={() => {
              if (menuRef.current) menuRef.current.open = false;
              endDrag(); setMoveError(null); setMoveMessage(null);
              setSelectionMode(!selectionMode); setCheckedItems(new Set());
            }}>{selectionMode ? "選択終了" : "選択"}</button>
        </div>
        {selectionMode && <div className="flex flex-wrap items-center gap-2" data-notebook-selection>
          <p className="w-full text-sm" role="status">{checked.length}件選択中</p>
          <button type="button" className="btn btn-sm" disabled={unavailable || !allItems.length}
            title="閉じたフォルダの中も含む全項目を選択"
            onClick={() => setCheckedItems(new Set(allItems.map(noteItemKey)))}>全選択</button>
          <button type="button" className="btn btn-sm" disabled={unavailable || !checked.length}
            onClick={() => setCheckedItems(new Set())}>選択解除</button>
          <button type="button" className="btn btn-sm" disabled={unavailable || !checked.length}
            onClick={() => { setMoveError(null); setBulkMoving(true); }}>移動</button>
          {props.onBackupItems && <button type="button" className="btn btn-sm" disabled={unavailable || !checked.length}
            onClick={() => {
              if (unavailable || !checked.length) return;
              endDrag();
              props.onBackupItems?.(checked.map((item) => ({ ...item })));
            }}>編集用ZIPで保存</button>}
          {(props.onSaveToDrive || props.onSaveItemsToDrive) && <button type="button" className="btn btn-sm"
            disabled={unavailable || !checkedNotes.length || (!props.onSaveItemsToDrive && checked.length !== 1)}
            title="選択したノートをDriveに手動バックアップ" onClick={() => {
              if (unavailable || !checkedNotes.length) return;
              endDrag();
              if (props.onSaveItemsToDrive) props.onSaveItemsToDrive(checkedNotes.map((note) => ({ ...note })));
              else if (checked.length === 1) props.onSaveToDrive?.(checkedNotes[0].id);
            }}>Driveにバックアップ</button>}
          <button type="button" className="btn btn-sm text-error" disabled={unavailable || !checked.length}
            onClick={() => {
              setMoveError(null); setMoveMessage(null);
              setDeleting({ items: checked.map((item) => ({ ...item })), library: library });
            }}>削除</button>
        </div>}
        {moveMessage && <p role="status" className="text-sm">{moveMessage}</p>}
        {moveError && !action && !bulkMoving && !deleting && <p role="alert" className="text-error">{moveError}</p>}
        {driveStatusError && <p role="alert" className="text-xs text-error">{driveStatusError}</p>}
        {isLoading ? <p role="status">読み込み中…</p>
          : result.error ? <p role="alert" className="text-error">{result.error}</p>
          : (
            <>
              {library.foldersEnabled && (
                <button type="button" disabled={unavailable}
                  className={`btn btn-sm btn-ghost w-full justify-start ${selection === "root" ? "bg-base-200" : ""} ${dropTarget === "root" ? "outline-2 outline-primary bg-base-200" : ""}`}
                  aria-label="一番上" data-notebook-drop="root"
                  onClick={() => setSelection("root")}
                  onDragOver={(event) => dragOver(event, null)}
                  onDragLeave={dragLeave}
                  onDrop={(event) => drop(event, null)}
                >一番上</button>
              )}
              {library.notes.length === 0 && library.folders.length === 0
                ? <p>ノートはありません。</p>
                : <ul className="menu menu-sm notebook-tree w-full max-h-[70vh] flex-nowrap overflow-auto p-0"
                  data-notebook-drop="root" data-selecting={selectionMode}
                  onDragOver={(event) => dragOver(event, null)} onDragLeave={dragLeave}
                  onDrop={(event) => drop(event, null)}>
                  <NotebookTree tree={result.tree} expanded={expanded} currentNoteId={props.currentNoteId}
                    driveStatuses={shownDriveStatuses}
                    selected={selected} onSelect={(item) => {
                      // ノートを開く操作は実際の表示中IDに追従する。切り替えをキャンセルしても対象がずれない。
                      setSelection(item.kind === "note" ? null : item);
                    }}
                    disabled={unavailable} onOpen={props.onOpen}
                    dragEnabled={canOrganize && !action && !selectionMode && !bulkMoving}
                    selectionMode={selectionMode} checkedItems={checkedItems} onCheck={toggleChecked}
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
        {props.onOpenSticky && <StickyNotesPanel notes={library.notes} current={props.currentStickyOutline}
          currentPageId={props.currentPageId} disabled={unavailable || !!action || selectionMode || bulkMoving || !!deleting}
          onNavigate={props.onOpenSticky} />}
      </div>
      {action && <NotebookActionDialog action={action} library={library} driveLinked={driveLinked}
        busy={props.disabled || isMutating} error={moveError} onSubmit={handleSubmit}
        onClose={() => {
          if (!mutationRef.current) { setAction(null); setMoveError(null); }
        }} />}
      {bulkMoving && <NotebookMoveDialog items={checked} library={library}
        busy={props.disabled || isMutating} error={moveError} onSubmit={moveChecked}
        onClose={() => { if (!mutationRef.current) { setBulkMoving(false); setMoveError(null); } }} />}
      {deleting && <NotebookDeleteDialog items={deleting.items} library={deleting.library} driveLinked={driveLinked}
        busy={props.disabled || isMutating} error={moveError} onSubmit={deleteChecked}
        onClose={() => { if (!mutationRef.current) { setDeleting(null); setMoveError(null); } }} />}
      {touchPreview && <div aria-hidden="true" className="pointer-events-none fixed z-20 max-w-48 truncate rounded-box border border-base-300 bg-base-100 px-3 py-2 text-sm shadow-lg"
        style={{ left: Math.max(8, Math.min(touchPreview.x - 48, 140)), top: Math.max(8, touchPreview.y - 56) }}>
        {touchPreview.name}
      </div>}
    </nav>
  );
}
