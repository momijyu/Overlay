"use client";

import { useState } from "react";
import { EditorHelpDialog } from "@/features/pdf-editor/components/EditorHelpDialog";

export function UsageGuideButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn min-h-11" aria-haspopup="dialog"
        onClick={() => setOpen(true)}>使い方を見る</button>
      {open && <EditorHelpDialog onClose={() => setOpen(false)} />}
    </>
  );
}
