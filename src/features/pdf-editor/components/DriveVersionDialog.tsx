"use client";
import { useEffect, useRef } from "react";
import type { DriveVersionRequired } from "../driveLibraryCache";
export function DriveVersionDialog({ choice, onChoose, onClose }: {
  choice: DriveVersionRequired; onChoose: (id: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="drive-version-title" onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <div className="modal-box flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-box p-0">
      <h2 id="drive-version-title" className="shrink-0 border-b border-base-300 px-5 py-4 text-lg font-bold">今後使う内容を選択</h2>
      <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-5 py-4" data-conflict-scroll>
      <p className="text-sm break-words [overflow-wrap:anywhere]">{choice.title}</p>
      <p className="text-sm">採用した内容を他の端末でも使います。選ばなかった内容はDriveに残ります。</p>
      <ul className="space-y-2">{[...choice.sources].sort((a, b) => (Date.parse(b.updatedAt ?? "") || 0) - (Date.parse(a.updatedAt ?? "") || 0) || a.noteId.localeCompare(b.noteId)).map((source, index) => <li key={source.noteId}>
        <button type="button" className="btn h-auto min-h-16 w-full flex-col items-start gap-1 whitespace-normal py-3 text-left [overflow-wrap:anywhere]" onClick={() => onChoose(source.noteId)}>
          <span>内容{index + 1} · {source.deviceId === choice.deviceId ? "このブラウザの保存先" : "別のブラウザ・端末の保存先"}</span>
          <span className="text-xs font-normal">Drive保存日時：{source.updatedAt && Number.isFinite(Date.parse(source.updatedAt)) ? new Date(source.updatedAt).toLocaleString("ja-JP") : "不明"}</span>
          <span className="text-xs">この内容を採用</span>
        </button>
      </li>)}</ul>
      </div>
      <div className="flex shrink-0 justify-end border-t border-base-300 px-5 py-3"><button type="button" className="btn" onClick={onClose}>キャンセル</button></div>
    </div>
    <div className="modal-backdrop"><button type="button" aria-label="版の選択を閉じる" onClick={onClose} /></div>
  </dialog>;
}
