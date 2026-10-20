import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_NOTE_TEXT_LENGTH, normalizeNoteText } from "../textData";
import type { TextNote } from "../types";

// 旧モーダル形式。通常画面はTextBoxEditorの直接入力に統一している。
export function TextNoteDialog({ note, onClose, onSubmit, onDelete }: {
  note: TextNote;
  onClose: () => void;
  onSubmit: (text: string) => void;
  onDelete?: () => void;
}) {
  const [text, setText] = useState(note.text);
  const [error, setError] = useState<string | null>(null);
  const composing = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (composing.current) return;
    try {
      const next = normalizeNoteText(text);
      if (!next.trim()) throw new Error("文章を入力してください。");
      if (next.length > MAX_NOTE_TEXT_LENGTH) throw new Error(`文章は${MAX_NOTE_TEXT_LENGTH}文字以内にしてください。`);
      onSubmit(next);
    } catch (error) { setError(error instanceof Error ? error.message : "変更できませんでした。"); }
  }
  return (
    <dialog ref={dialogRef} className="modal pointer-events-auto" aria-label={note.kind === "sticky" ? "付箋の編集" : "テキストの編集"}
      onCancel={(event) => { event.preventDefault(); if (!composing.current) onClose(); }}>
      <form className="modal-box" onSubmit={submit}>
        <label className="label" htmlFor="note-text">{note.kind === "sticky" ? "付箋" : "テキスト"}</label>
        <textarea id="note-text" className="textarea w-full min-h-40" value={text} autoFocus
          maxLength={MAX_NOTE_TEXT_LENGTH} onChange={(event) => setText(event.target.value)}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
        {error && <p className="text-error" role="alert">{error}</p>}
        <div className="modal-action">
          {onDelete && <button type="button" className="btn" onClick={onDelete}>削除</button>}
          <button type="button" className="btn" onClick={onClose}>キャンセル</button>
          <button type="submit" className="btn btn-primary">適用</button>
        </div>
      </form>
    </dialog>
  );
}
