"use client";

import { useEffect, useRef, type ReactNode } from "react";

// 一覧をチェックするため、外側操作では操作欄だけ閉じて選択を保持する。
export function NotebookSelectionMenu({ open, onDismiss, children }: {
  open: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let pointerActive = false;
    function pointerDown() { pointerActive = true; }
    function pointerUp() { pointerActive = false; }
    function outside(event: Event) {
      if (event.type === "focusin" && pointerActive) return;
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    }
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("pointerup", pointerUp, true);
    document.addEventListener("pointercancel", pointerUp, true);
    document.addEventListener("click", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("pointerup", pointerUp, true);
      document.removeEventListener("pointercancel", pointerUp, true);
      document.removeEventListener("click", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [open, onDismiss]);

  return <div ref={ref} className="contents" onKeyDown={(event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault(); event.stopPropagation();
    onDismiss();
    ref.current?.querySelector("button")?.focus();
  }}>{children}</div>;
}
