"use client";

import { useRef } from "react";

// タッチ版のツールバーはoverflow:hiddenのため、操作一覧をdialogの最前面に出す。
export function PageActionsMenu({ disabled, canInsert, canDelete, canClear, onInsert, onDelete, onClear }: {
  disabled: boolean; canInsert: boolean; canDelete: boolean; canClear: boolean;
  onInsert: () => void; onDelete: () => void; onClear: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  function choose(allowed: boolean, action: () => void) {
    if (disabled || !allowed) return;
    ref.current?.close();
    action();
  }
  return <>
    <button type="button" className="btn page-actions-trigger px-2 text-xs" aria-label="ページ操作" title="ページ操作"
      disabled={disabled} onClick={() => { if (!disabled) ref.current?.showModal(); }}>
      ページ操作
    </button>
    <dialog ref={ref} className="modal" aria-label="ページ操作">
      <div className="modal-box flex max-h-[calc(100dvh-2rem)] max-w-sm flex-col overflow-hidden rounded-box">
        <h3 className="mb-3 shrink-0 text-lg font-semibold">ページ操作</h3>
        <ul className="menu min-h-0 w-full overflow-y-auto p-0">
          <li><button type="button" className="min-h-11" aria-label="次に空白ページを追加" disabled={disabled || !canInsert}
            onClick={() => choose(canInsert, onInsert)}>次に白紙追加</button></li>
          <li><button type="button" className="min-h-11" disabled={disabled || !canClear}
            onClick={() => choose(canClear, onClear)}>書き込みを一括削除</button></li>
          <li><button type="button" className="min-h-11 text-error" disabled={disabled || !canDelete}
            title={!canDelete ? "最後の1ページは削除できません" : undefined}
            onClick={() => choose(canDelete, onDelete)}>ページを削除</button></li>
        </ul>
        <div className="modal-action mt-3 shrink-0"><button type="button" className="btn min-h-11" onClick={() => ref.current?.close()}>閉じる</button></div>
      </div>
      <form method="dialog" className="modal-backdrop"><button type="submit" aria-label="閉じる">閉じる</button></form>
    </dialog>
  </>;
}
