"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { createNoteFolder, FOLDER_SETUP_MESSAGE, loadNoteLibrary, organizeNote } from "../noteFolders";
import { buildNoteTree, folderChoices, type NoteTree } from "../noteTree";
import type { NoteLibrary, SavedNoteSummary } from "../types";

type SidebarProps = {
  refreshVersion: number;
  currentNoteId: string | null;
  disabled: boolean;
  onOpen: (note: SavedNoteSummary) => void;
  onRenamed: (id: string, title: string) => void;
  onMutationChange: (busy: boolean) => void;
};

type TreeEntriesProps = Pick<SidebarProps, "currentNoteId" | "disabled" | "onOpen"> & {
  tree: NoteTree;
  expanded: Set<string>;
  onToggle: (id: string, open: boolean) => void;
};

function TreeEntries(props: TreeEntriesProps) {
  return (
    <>
      {props.tree.folders.map((folder) => (
        <li key={folder.id}>
          <details
            open={props.expanded.has(folder.id)}
            onToggle={(event) => props.onToggle(folder.id, event.currentTarget.open)}
          >
            <summary className="break-all">{folder.name}</summary>
            <ul>
              <TreeEntries {...props} tree={folder} />
              {folder.folders.length === 0 && folder.notes.length === 0 && (
                <li><span className="text-base-content/60">空のフォルダ</span></li>
              )}
            </ul>
          </details>
        </li>
      ))}
      {props.tree.notes.map((note) => (
        <li key={note.id}>
          <button
            type="button"
            className={`break-all ${note.id === props.currentNoteId ? "menu-active" : ""}`}
            aria-current={note.id === props.currentNoteId ? "page" : undefined}
            disabled={props.disabled}
            onClick={() => {
              if (note.id !== props.currentNoteId) props.onOpen(note);
            }}
          >
            {note.title}
          </button>
        </li>
      ))}
    </>
  );
}

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
  const [form, setForm] = useState<"folder" | "note" | null>(null);
  const [name, setName] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const mutationRef = useRef(false);
  const mountedRef = useRef(false);
  const isLoading = result.key !== requestKey;
  const currentNote = result.library.notes.find((note) => note.id === props.currentNoteId);
  const choices = folderChoices(result.tree);
  const unavailable = props.disabled || isLoading || result.error !== null;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (unavailable || mutationRef.current || !form) return;
    mutationRef.current = true;
    props.onMutationChange(true);
    setFormError(null);
    try {
      const folderId = destination || null;
      if (form === "folder") {
        const id = await createNoteFolder(name, folderId);
        if (!mountedRef.current) return;
        expandParents(folderId, id);
      } else {
        if (!editingNoteId) throw new Error("保存済みのノートを選択してください。");
        await organizeNote(editingNoteId, name, folderId);
        if (!mountedRef.current) return;
        props.onRenamed(editingNoteId, name.trim());
        expandParents(folderId);
      }
      setForm(null);
      setRetry((value) => value + 1);
    } catch (error) {
      if (mountedRef.current) {
        setFormError(error instanceof Error ? error.message : "変更を保存できませんでした。");
      }
    } finally {
      mutationRef.current = false;
      if (mountedRef.current) props.onMutationChange(false);
    }
  }

  return (
    <nav aria-labelledby="notebook-heading" className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="notebook-heading" className="font-semibold">ノート</h2>
          <button type="button" className="btn btn-sm" disabled={props.disabled || isLoading}
            onClick={() => setRetry((value) => value + 1)}>更新</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm"
            disabled={unavailable || !result.library.foldersEnabled}
            onClick={() => { setForm("folder"); setName(""); setDestination(""); setFormError(null); }}>
            フォルダ作成
          </button>
          <button type="button" className="btn btn-sm"
            disabled={unavailable || !result.library.foldersEnabled || !currentNote}
            onClick={() => {
              if (!currentNote) return;
              setForm("note"); setEditingNoteId(currentNote.id); setName(currentNote.title);
              setDestination(currentNote.folderId ?? ""); setFormError(null);
            }}>
            名前・保存先
          </button>
        </div>
        {form && (
          <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-2 border-b border-base-300 pb-3">
            <label htmlFor="notebook-name" className="label">{form === "folder" ? "フォルダ名" : "ノート名"}</label>
            <input id="notebook-name" className="input w-full" required
              maxLength={form === "folder" ? 100 : 120} value={name} disabled={props.disabled}
              onChange={(event) => setName(event.target.value)} />
            <label htmlFor="notebook-destination" className="label">{form === "folder" ? "親フォルダ" : "保存先"}</label>
            <select id="notebook-destination" className="select w-full" value={destination}
              disabled={props.disabled} onChange={(event) => setDestination(event.target.value)}>
              <option value="">最上位</option>
              {choices.map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
            </select>
            {formError && <p role="alert" className="text-error">{formError}</p>}
            <div className="flex gap-2">
              <button className="btn btn-sm" type="submit" disabled={unavailable}>
                {form === "folder" ? "作成" : "変更"}
              </button>
              <button className="btn btn-sm" type="button" disabled={props.disabled}
                onClick={() => setForm(null)}>キャンセル</button>
            </div>
          </form>
        )}
        {isLoading ? <p role="status">読み込み中…</p>
          : result.error ? <p role="alert" className="text-error">{result.error}</p>
          : (
            <>
              {!result.library.foldersEnabled && <p role="status">{FOLDER_SETUP_MESSAGE}</p>}
              {result.library.notes.length === 0 && result.library.folders.length === 0
                ? <p>ノートはありません。</p>
                : <ul className="menu menu-sm w-full max-h-[70vh] flex-nowrap overflow-auto p-0">
                  <TreeEntries tree={result.tree} expanded={expanded} currentNoteId={props.currentNoteId}
                    disabled={props.disabled || form !== null} onOpen={props.onOpen}
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
    </nav>
  );
}
