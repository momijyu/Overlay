"use client";

import { useEffect, type ReactNode, type RefObject } from "react";

// 一覧内の操作を閉じる際に、一覧ドロワーまで閉じない。
export function NotebookActionsMenu({ menuRef, visible = true, onOpen, children }: {
  menuRef: RefObject<HTMLDetailsElement | null>;
  visible?: boolean;
  onOpen?: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!visible) {
      if (menuRef.current) menuRef.current.open = false;
      return;
    }
    let pointerActive = false;
    function pointerDown() { pointerActive = true; }
    function pointerUp() { pointerActive = false; }
    function outside(event: Event) {
      // ポインター操作の途中に一覧を詰めると、押した項目が移動してしまう。
      if (event.type === "focusin" && pointerActive) return;
      const menu = menuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
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
  }, [menuRef, visible]);

  return <details ref={menuRef} className="notebook-actions-menu contents" onKeyDown={(event) => {
    const menu = menuRef.current;
    if (event.key !== "Escape" || !menu?.open) return;
    event.preventDefault(); event.stopPropagation();
    menu.open = false;
    menu.querySelector("summary")?.focus();
  }}>
    {/* summaryは常に開閉可能。処理中の制限は各メニュー項目で行う。 */}
    <summary className="btn btn-sm col-start-2 row-start-1" onClick={() => { if (!menuRef.current?.open) onOpen?.(); }}>操作</summary>
    {children}
  </details>;
}
