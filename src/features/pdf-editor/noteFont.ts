import type { Font } from "@pdf-lib/fontkit";

export type NoteFont = { bytes: Uint8Array; font: Font };
let pending: Promise<NoteFont> | null = null;
let loaded: NoteFont | null = null;

export function loadedNoteFont(): NoteFont | null { return loaded; }

export function loadNoteFont(): Promise<NoteFont> {
  if (pending) return pending;
  pending = (async () => {
    const [response, { default: fontkit }] = await Promise.all([
      fetch("/fonts/NotoSansJP-Regular.otf"), import("@pdf-lib/fontkit"),
    ]);
    if (!response.ok) throw new Error("日本語フォントを読み込めませんでした。");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const font = fontkit.create(bytes);
    if (typeof FontFace !== "undefined" && typeof document !== "undefined") {
      const face = new FontFace("OverlayNotes", bytes);
      await face.load();
      document.fonts.add(face);
    }
    loaded = { bytes, font };
    return loaded;
  })().catch((error) => { pending = null; throw error; });
  return pending;
}
