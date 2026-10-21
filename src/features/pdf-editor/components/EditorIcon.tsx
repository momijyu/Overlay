import type { ReactNode } from "react";
import type { EditorTool } from "../types";

export type EditorIconName = EditorTool | "undo" | "redo" | "previous-page" | "next-page";

// Lucide 1.59.0の公式SVGをインライン化。図形は変更せず、表示サイズと線幅は従来どおり。
// Source: https://github.com/lucide-icons/lucide/tree/1.59.0/icons
// Copyright (c) 2026 Lucide Icons and Contributors — ISC License.
// ライセンス全文: public/licenses/lucide-LICENSE.txt（公開サイトにも同梱する）。
// アイコンの対応・取得元・変更点: docs/icon-sources.md
export function EditorIcon({ name }: { name: EditorIconName }) {
  const drawing = {
    pen: <>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </>,
    marker: <>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </>,
    eraser: <>
      <path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21" />
      <path d="m5.082 11.09 8.828 8.828" />
    </>,
    text: <>
      <path d="M14 21h1" />
      <path d="M14 3h1" />
      <path d="M19 3a2 2 0 0 1 2 2" />
      <path d="M21 14v1" />
      <path d="M21 19a2 2 0 0 1-2 2" />
      <path d="M21 9v1" />
      <path d="M3 14v1" />
      <path d="M3 9v1" />
      <path d="M5 21a2 2 0 0 1-2-2" />
      <path d="M5 3a2 2 0 0 0-2 2" />
      <path d="M7 12h10" />
      <path d="M7 16h6" />
      <path d="M7 8h8" />
      <path d="M9 21h1" />
      <path d="M9 3h1" />
    </>,
    sticky: <>
      <path d="M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z" />
      <path d="M15 3v5a1 1 0 0 0 1 1h5" />
    </>,
    undo: <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
    </>,
    redo: <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />
    </>,
    "previous-page": <path d="m15 18-6-6 6-6" />,
    "next-page": <path d="m9 18 6-6-6-6" />,
  } satisfies Record<EditorIconName, ReactNode>;

  return <svg viewBox="0 0 24 24" className="size-6 shrink-0" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {drawing[name]}
  </svg>;
}
