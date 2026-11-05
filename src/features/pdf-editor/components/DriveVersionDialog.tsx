"use client";
import { useEffect, useRef } from "react";
import type { DriveVersionRequired } from "../driveLibraryCache";
export function DriveVersionDialog({ choice, onChoose, onClose }: {
  choice: DriveVersionRequired; onChoose: (id: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="drive-version-title" onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <div className="modal-box rounded-box space-y-3">
      <h2 id="drive-version-title" className="text-lg font-bold">開く版を選択</h2>
      <p className="text-sm break-words">{choice.title}</p>
      <p className="text-sm">端末ごとの編集を保持しています。</p>
      <ul className="space-y-2">{choice.sources.map((source) => <li key={source.noteId}>
        <button type="button" className="btn w-full justify-start" onClick={() => onChoose(source.noteId)}>端末 {source.deviceId.slice(0, 8)} · {source.updatedAt ? new Date(source.updatedAt).toLocaleString("ja-JP") : source.noteKey.slice(0, 8)}</button>
      </li>)}</ul>
      <div className="modal-action"><button type="button" className="btn" onClick={onClose}>キャンセル</button></div>
    </div>
    <div className="modal-backdrop"><button type="button" aria-label="版の選択を閉じる" onClick={onClose} /></div>
  </dialog>;
}
