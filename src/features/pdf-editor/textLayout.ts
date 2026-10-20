import type { Font } from "@pdf-lib/fontkit";
import type { TextNote } from "./types";

export const TEXT_PADDING = 6;
export const STICKY_BACKGROUND = "#fff3b0"; // 仮の付箋色。全体テーマとは分離する。

export function textNoteLayout(note: TextNote, pageWidth: number, font: Font, pageHeight = 0) {
  const width = note.width * pageWidth;
  const innerWidth = width - TEXT_PADDING * 2;
  const widths = new Map<string, number>();
  function measure(char: string) {
    if (!widths.has(char)) widths.set(char, font.layout(char, { liga: false, kern: false }).glyphs
      .reduce((sum, glyph) => sum + glyph.advanceWidth, 0) * note.fontSize / font.unitsPerEm);
    return widths.get(char)!;
  }
  const lines: string[] = [];
  for (const paragraph of note.text.split("\n")) {
    let line = "";
    let lineWidth = 0;
    for (const char of Array.from(paragraph)) {
      if (!font.hasGlyphForCodePoint(char.codePointAt(0)!)) throw new Error(`この文字はPDFに出力できません：${char}`);
      const charWidth = measure(char);
      if (charWidth > innerWidth) throw new Error("テキストボックスの幅が足りません。");
      if (line && lineWidth + charWidth > innerWidth) { lines.push(line); line = ""; lineWidth = 0; }
      line += char;
      lineWidth += charWidth;
    }
    lines.push(line);
  }
  const ascent = font.ascent / font.unitsPerEm * note.fontSize;
  const descent = font.descent / font.unitsPerEm * note.fontSize;
  const lineHeight = Math.max(note.fontSize * 1.5, ascent - descent);
  const contentHeight = TEXT_PADDING * 2 + (lines.length - 1) * lineHeight + ascent - descent;
  return { lines, width, lineHeight, baseline: TEXT_PADDING + ascent, contentHeight,
    height: Math.max(contentHeight, (note.height ?? 0) * pageHeight) };
}

export function fitTextNote(note: TextNote, pageWidth: number, pageHeight: number, font: Font): TextNote {
  if (note.autoSize) {
    // 手動の箱サイズではなく、改行ごとの文字幅から求める。長い行だけページ幅で折り返す。
    const widths = new Map<string, number>();
    let widest = 0;
    for (const paragraph of note.text.split("\n")) {
      let width = 0;
      for (const char of Array.from(paragraph)) {
        if (!font.hasGlyphForCodePoint(char.codePointAt(0)!)) throw new Error(`この文字はPDFに出力できません：${char}`);
        if (!widths.has(char)) widths.set(char, font.layout(char, { liga: false, kern: false }).glyphs
          .reduce((sum, glyph) => sum + glyph.advanceWidth, 0) * note.fontSize / font.unitsPerEm);
        width += widths.get(char)!;
      }
      widest = Math.max(widest, width);
    }
    const width = Math.min(pageWidth, Math.max(80, widest + TEXT_PADDING * 2 + 0.01)) / pageWidth;
    const fitted = { ...note, width };
    delete fitted.height; // 以前の手動サイズから変更した場合も、空白の高さを引き継がない。
    note = fitted;
  }
  const layout = textNoteLayout(note, pageWidth, font, pageHeight);
  if (layout.height > pageHeight) throw new Error("文章がページの高さを超えています。短くしてください。");
  return { ...note, x: Math.max(0, Math.min(note.x, 1 - note.width)),
    y: Math.max(0, Math.min(note.y, 1 - layout.height / pageHeight)) };
}
