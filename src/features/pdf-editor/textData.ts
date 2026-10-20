import type { TextNote, TextNotesByPage } from "./types";
import { isPenColor } from "./penStyle";

export const MAX_NOTE_TEXT_LENGTH = 2000;
export const MIN_NOTE_FONT_SIZE = 8;
export const MAX_NOTE_FONT_SIZE = 48;

export function readTextNotes(value: unknown): TextNotesByPage {
  if (value === undefined) return {}; // テキストを持たない旧ノート。
  const invalid = () => new Error("保存されたテキスト情報を読み込めませんでした。");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const result: TextNotesByPage = {};
  for (const [page, notes] of Object.entries(value)) {
    if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page)) || !Array.isArray(notes)) throw invalid();
    const ids = new Set<string>();
    result[Number(page)] = notes.map((value: unknown): TextNote => {
      if (!value || typeof value !== "object") throw invalid();
      const note = value as Record<string, unknown>;
      const { id, kind, text, x, y, width, height, fontSize, autoSize, color, backgroundColor } = note;
      if (typeof id !== "string" || !id || id.length > 100 || ids.has(id)
        || (kind !== "text" && kind !== "sticky") || typeof text !== "string"
        || !text.trim() || text.length > MAX_NOTE_TEXT_LENGTH
        || Array.from(text).some((char) => /\p{Cc}/u.test(char) && char !== "\n")
        || typeof x !== "number" || !Number.isFinite(x) || x < 0 || x >= 1
        || typeof y !== "number" || !Number.isFinite(y) || y < 0 || y >= 1
        || typeof width !== "number" || !Number.isFinite(width) || width <= 0 || width > 1 || x + width > 1.000001
        || (height !== undefined && (typeof height !== "number" || !Number.isFinite(height)
          || height <= 0 || height > 1 || y + height > 1.000001 || kind !== "text"))
        || (autoSize !== undefined && typeof autoSize !== "boolean")
        || (color !== undefined && !isPenColor(color))
        || (backgroundColor !== undefined && (kind !== "sticky" || !isPenColor(backgroundColor)))
        || typeof fontSize !== "number" || !Number.isFinite(fontSize)
        || fontSize < MIN_NOTE_FONT_SIZE || fontSize > MAX_NOTE_FONT_SIZE) throw invalid();
      ids.add(id);
      return { id, kind, text, x, y, width, fontSize, ...(height === undefined ? {} : { height: height as number }),
        ...(autoSize === undefined ? {} : { autoSize: autoSize as boolean }),
        ...(color === undefined ? {} : { color: color as string }),
        ...(backgroundColor === undefined ? {} : { backgroundColor: backgroundColor as string }) };
    });
  }
  return result;
}

export function normalizeNoteText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
}
