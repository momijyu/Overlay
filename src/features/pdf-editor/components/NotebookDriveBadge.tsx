import { NOTE_DRIVE_LABELS, type NoteDriveStatus } from "../noteDriveStatus";

// Lucide 1.59.0: cloud / cloud-upload / cloud-alert の公式SVG。
// Copyright (c) 2026 Lucide Icons and Contributors — ISC License.
// 全文: public/licenses/lucide-LICENSE.txt。出典: docs/icon-sources.md。
export function NotebookDriveBadge({ status }: { status: NoteDriveStatus }) {
  const label = NOTE_DRIVE_LABELS[status];
  return <span className={`notebook-drive-status tooltip tooltip-left ${status === "warning" ? "text-error" : "text-base-content/70"}`}
    data-tip={label} onClick={(event) => { event.stopPropagation(); event.preventDefault(); }}>
    <span role="img" aria-label={label} title={label} tabIndex={0} className="flex rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
      onClick={(event) => event.currentTarget.focus()}>
      <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {status === "saved" && <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />}
        {status === "pending" && <><path d="M12 13v8" /><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="m8 17 4-4 4 4" /></>}
        {status === "warning" && <><path d="M12 12v4" /><path d="M12 20h.01" /><path d="M8.128 16.949A7 7 0 1 1 15.71 8h1.79a1 1 0 0 1 0 9h-1.642" /></>}
      </svg>
    </span>
  </span>;
}
