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
        <li key={folder.id}>
          <details open={props.expanded.has(folder.id)}
            onToggle={(event) => props.onToggle(folder.id, event.currentTarget.open)}>
            <summary
              className={`break-all ${props.selected?.kind === "folder" && props.selected.id === folder.id ? "bg-base-200" : ""} ${props.dropTarget === folder.id ? "outline-2 outline-primary bg-base-200" : ""} ${props.dragging?.kind === "folder" && props.dragging.id === folder.id ? "opacity-50" : ""}`}
              onClick={(event) => {
                if (props.disabled) event.preventDefault();
                else props.onSelect({ kind: "folder", id: folder.id });
              }}
              draggable={props.dragEnabled && !props.disabled}
              onDragStart={(event) => props.onDragStart(event, { kind: "folder", id: folder.id })}
              onDragEnd={props.onDragEnd}
              onDragOver={(event) => props.onDragOver(event, folder.id)}
              onDragLeave={props.onDragLeave}
              onDrop={(event) => props.onDrop(event, folder.id)}
            >{folder.name}</summary>
            <ul>
              <NotebookTree {...props} tree={folder} />
              {folder.folders.length === 0 && folder.notes.length === 0 && (
                <li><span className="text-base-content/60">空のフォルダ</span></li>
              )}
            </ul>
          </details>
        </li>
      ))}
      {props.tree.notes.map((note) => (
        <li key={note.id}>
          <button type="button"
            className={`break-all ${note.id === props.currentNoteId ? "menu-active" : ""} ${props.selected?.kind === "note" && props.selected.id === note.id ? "outline-1 outline-base-300" : ""} ${props.dragging?.kind === "note" && props.dragging.id === note.id ? "opacity-50" : ""}`}
            aria-current={note.id === props.currentNoteId ? "page" : undefined}
            disabled={props.disabled} draggable={props.dragEnabled && !props.disabled}
            onDragStart={(event) => props.onDragStart(event, { kind: "note", id: note.id })}
            onDragEnd={props.onDragEnd}
            onClick={() => {
              if (props.disabled) return;
              props.onSelect({ kind: "note", id: note.id });
              if (note.id !== props.currentNoteId) props.onOpen(note);
            }}>{note.title}</button>
        </li>
      ))}
    </>
  );
}
