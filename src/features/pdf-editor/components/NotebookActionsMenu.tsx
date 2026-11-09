"use client";

import { useEffect, type ReactNode, type RefObject } from "react";

// 一覧内の操作を閉じる際に、一覧ドロワーまで閉じない。
export function NotebookActionsMenu({ menuRef, visible = true, children }: {
  menuRef: RefObject<HTMLDetailsElement | null>;
  visible?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!visible) {
      if (menuRef.current) menuRef.current.open = false;
      return;
    }
    function outside(event: Event) {
      const menu = menuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [menuRef, visible]);

  return <details ref={menuRef} className="dropdown static" onKeyDown={(event) => {
    const menu = menuRef.current;
    if (event.key !== "Escape" || !menu?.open) return;
    event.preventDefault(); event.stopPropagation();
    menu.open = false;
    menu.querySelector("summary")?.focus();
  }}>
    {/* summaryは常に開閉可能。処理中の制限は各メニュー項目で行う。 */}
    <summary className="btn btn-sm">操作</summary>
    {children}
  </details>;
}
