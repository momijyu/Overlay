import { ANNOTATION_CLIPBOARD_TYPE } from "./annotationSelection";

// ボタン用の一時コピー。ページをまたげるが、再読み込みで消え、DB・Driveには保存しない。
let copied = "";
const listeners = new Set<() => void>();
export const annotationClipboard = {
  get: () => copied,
  set(value: string) { copied = value; listeners.forEach((listener) => listener()); },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

export function bindAnnotationClipboard(target: Window, options: {
  owns: (target: EventTarget | null) => boolean;
  copy: () => { data: string; text: string } | null;
  paste: (data: string) => void;
  clear: () => void;
}) {
  const eligible = (event: Event) => options.owns(event.target) && !(event.target as Element | null)?.closest?.("input, textarea, select, [contenteditable], dialog[open], [role=dialog]");
  const copy = (event: ClipboardEvent) => {
    if (!eligible(event) || !event.clipboardData) return;
    const value = options.copy();
    if (!value) return;
    event.clipboardData.setData(ANNOTATION_CLIPBOARD_TYPE, value.data);
    event.clipboardData.setData("text/plain", value.text);
    event.preventDefault();
  };
  const paste = (event: ClipboardEvent) => {
    if (!eligible(event)) return;
    const value = event.clipboardData?.getData(ANNOTATION_CLIPBOARD_TYPE);
    if (!value) return; // 通常の文章や画像を、以前コピーしたオブジェクトへ置き換えない。
    event.preventDefault(); options.paste(value);
  };
  const key = (event: KeyboardEvent) => {
    if (eligible(event) && !event.isComposing && event.key === "Escape") { options.clear(); event.preventDefault(); }
  };
  target.addEventListener("copy", copy);
  target.addEventListener("paste", paste);
  target.addEventListener("keydown", key);
  return () => { target.removeEventListener("copy", copy); target.removeEventListener("paste", paste); target.removeEventListener("keydown", key); };
}
