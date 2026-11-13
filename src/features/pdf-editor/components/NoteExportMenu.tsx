import { useEffect, useRef } from "react";
import { EditorIcon } from "./EditorIcon";

// PCとタッチで、閲覧用PDFと再編集用バックアップの入口・説明をそろえる。
export function NoteExportMenu({ disabled, iconOnly = false, className = "", onDownload, onSelectPages, onBackup }: {
  disabled: boolean; iconOnly?: boolean; className?: string;
  onDownload: () => void; onSelectPages: () => void; onBackup: () => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function outside(event: Event) {
      const menu = ref.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, []);
  function choose(action: () => void) {
    if (disabled) return;
    if (ref.current) ref.current.open = false;
    action();
  }
  return <details ref={ref} className={`dropdown dropdown-end ${className}`} onKeyDown={(event) => {
    if (event.key !== "Escape" || !ref.current?.open) return;
    event.preventDefault(); event.stopPropagation();
    ref.current.open = false;
    ref.current.querySelector("summary")?.focus();
  }}>
    <summary className={`btn btn-sm ${iconOnly ? "btn-square btn-ghost" : ""}`}
      aria-label="書き出しメニュー" title="書き出しメニュー">
      {iconOnly ? <EditorIcon name="more" /> : "書き出し"}
    </summary>
    <div className="note-export-content dropdown-content z-30 mt-2 w-72 max-w-[calc(100vw-1rem)] rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
      <ul className="menu w-full p-0">
        <li><button type="button" className="flex-col items-start gap-0.5" disabled={disabled} onClick={() => choose(onDownload)}>
          <span>PDFを書き出す</span><span className="text-xs text-base-content/60">閲覧・共有用</span>
        </button></li>
        <li><button type="button" disabled={disabled} onClick={() => choose(onSelectPages)}>ページを指定してPDFを書き出す</button></li>
        <li><button type="button" className="flex-col items-start gap-0.5" disabled={disabled} onClick={() => choose(onBackup)}>
          <span>編集用バックアップ</span><span className="text-xs text-base-content/60">書き込みを再編集できる形式（.overlay）</span>
        </button></li>
      </ul>
      <p className="border-t border-base-300 px-2 pt-2 mt-2 text-xs leading-relaxed text-red-400" data-pdf-backup-notice>
        ※ 重要なノートは定期的に『PDFを書き出す』で保管してください。
      </p>
    </div>
  </details>;
}
