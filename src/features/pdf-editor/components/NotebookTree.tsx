"use client";

import type { DragEvent } from "react";

import type { NoteDragItem } from "../noteDrag";
import type { NoteTree } from "../noteTree";
import type { SavedNoteSummary } from "../types";

export type NotebookTreeProps = {
  tree: NoteTree;
  currentNoteId: string | null;
  selected: NoteDragItem | null;
  disabled: boolean;
  expanded: Set<string>;
  dragEnabled: boolean;
  dragging: NoteDragItem | null;
  dropTarget: string | null;
  onSelect: (item: NoteDragItem) => void;
  onOpen: (note: SavedNoteSummary) => void;
  onToggle: (id: string, open: boolean) => void;
  onDragStart: (event: DragEvent<HTMLElement>, item: NoteDragItem) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, folderId: string | null) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>, folderId: string | null) => void;
};

export function NotebookTree(props: NotebookTreeProps) {
  return (
    <>
      {props.tree.folders.map((folder) => (
        <li key={folder.id}
          className={props.dropTarget === folder.id ? "notebook-drop-target" : undefined}
          // フォルダ全体で受け取り、子フォルダが処理したイベントは親へ渡さない。
          onDragOver={(event) => { event.stopPropagation(); props.onDragOver(event, folder.id); }}
          onDragLeave={(event) => { event.stopPropagation(); props.onDragLeave(event); }}
          onDrop={(event) => { event.stopPropagation(); props.onDrop(event, folder.id); }}>
          <details open={props.expanded.has(folder.id)}
            onToggle={(event) => props.onToggle(folder.id, event.currentTarget.open)}>
            <summary
              className={`notebook-row notebook-folder ${props.selected?.kind === "folder" && props.selected.id === folder.id ? "bg-base-200" : ""} ${props.dropTarget === folder.id ? "outline-2 outline-primary bg-base-200" : ""} ${props.dragging?.kind === "folder" && props.dragging.id === folder.id ? "opacity-50" : ""}`}
              title={folder.name}
              aria-disabled={props.disabled}
              onClick={(event) => {
                if (props.disabled) event.preventDefault();
                else props.onSelect({ kind: "folder", id: folder.id });
              }}
              draggable={props.dragEnabled && !props.disabled}
              onDragStart={(event) => props.onDragStart(event, { kind: "folder", id: folder.id })}
              onDragEnd={props.onDragEnd}
            ><span className="notebook-label">{folder.name}</span></summary>
            {(folder.folders.length > 0 || folder.notes.length > 0) && (
              <ul className="notebook-children">
                <NotebookTree {...props} tree={folder} />
              </ul>
            )}
          </details>
        </li>
      ))}
      {props.tree.notes.map((note) => (
        <li key={note.id}>
          <button type="button"
            className={`notebook-row ${note.id === props.currentNoteId ? "menu-active" : ""} ${props.selected?.kind === "note" && props.selected.id === note.id ? "outline-1 outline-base-300" : ""} ${props.dragging?.kind === "note" && props.dragging.id === note.id ? "opacity-50" : ""}`}
            title={note.title}
            aria-current={note.id === props.currentNoteId ? "page" : undefined}
            disabled={props.disabled} draggable={props.dragEnabled && !props.disabled}
            onDragStart={(event) => props.onDragStart(event, { kind: "note", id: note.id })}
            onDragEnd={props.onDragEnd}
            onClick={() => {
              if (props.disabled) return;
              props.onSelect({ kind: "note", id: note.id });
              if (note.id !== props.currentNoteId) props.onOpen(note);
            }}><span className="notebook-label">{note.title}</span></button>
        </li>
      ))}
    </>
  );
}
