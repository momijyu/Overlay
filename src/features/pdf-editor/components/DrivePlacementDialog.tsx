"use client";
import { useEffect, useRef } from "react";
import type { LibraryConflictItem, LibraryEntity } from "../driveLibraryData";
export function DrivePlacementDialog({ conflict, entities, busy, onChoose, onClose }: {
  conflict: LibraryConflictItem; entities: LibraryEntity[]; busy: boolean; onChoose: (head: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
  const deletions = conflict.versions.some((v) => v.entry.deleted);
  function path(parent: string | null) {
    const parts: string[] = []; const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      visited.add(parent); const item = entities.find((e) => e.id === `folder:${parent}`);
      parts.unshift(item?.entry.name ?? parent); parent = item?.entry.parentId ?? null;
    }
    return parts.length ? parts.join(" / ") : "一番上";
  }
  return <dialog ref={ref} className="modal" aria-labelledby="drive-placement-title" onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}>
    <div className="modal-box rounded-box space-y-3">
      <h2 id="drive-placement-title" className="text-lg font-bold">名前・配置の競合</h2>
      <p className="text-sm">採用する名前・配置を選んでください。各端末の編集内容は残ります。</p>
      {deletions && <p className="text-sm text-error">削除が含まれるため停止しています。必要なノートを書き出して保管してください。</p>}
      <ul className="space-y-2">{conflict.versions.map((version) => <li key={version.head}>
        <button type="button" className="btn h-auto min-h-12 w-full flex-col items-start py-2 text-start" disabled={busy || deletions} onClick={() => onChoose(version.head)}>
          <span>{version.entry.name}</span><span className="text-xs font-normal break-words">{path(version.entry.parentId)} · 端末 {version.deviceId.slice(0, 8)}</span>
        </button>
      </li>)}</ul>
      <div className="modal-action"><button type="button" className="btn" disabled={busy} onClick={onClose}>キャンセル</button></div>
    </div>
  </dialog>;
}
