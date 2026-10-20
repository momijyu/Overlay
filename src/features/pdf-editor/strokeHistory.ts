import type { PenStroke, TextNote, TextNotesByPage } from "./types";

type Strokes = Record<number, PenStroke[]>;
type StrokeEdit = { before: Strokes; after: Strokes; beforeTexts: TextNotesByPage; afterTexts: TextNotesByPage; pageNumber: number };
export type StrokeHistory = {
  strokesByPage: Strokes;
  textsByPage: TextNotesByPage;
  past: StrokeEdit[];
  future: StrokeEdit[];
  changedPage: number | null;
  version: number;
};

export const STROKE_HISTORY_LIMIT = 100;

export function createStrokeHistory(strokesByPage: Strokes, textsByPage: TextNotesByPage = {}): StrokeHistory {
  return { strokesByPage, textsByPage, past: [], future: [], changedPage: null, version: 0 };
}

// 線の配列は描画・消去側も変更せず作り直すため、PDFや全座標を複製せず参照を保持できる。
export function recordStrokeEdit(history: StrokeHistory, pageNumber: number, strokes: PenStroke[]): StrokeHistory {
  const previous = history.strokesByPage[pageNumber];
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || previous === strokes
    || (!previous && strokes.length === 0)) return history;
  const next = { ...history.strokesByPage, [pageNumber]: strokes };
  return recordEdit(history, pageNumber, next, history.textsByPage);
}

export function recordTextEdit(history: StrokeHistory, pageNumber: number, texts: TextNote[]): StrokeHistory {
  const previous = history.textsByPage[pageNumber];
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || previous === texts
    || (!previous && texts.length === 0)) return history;
  return recordEdit(history, pageNumber, history.strokesByPage, { ...history.textsByPage, [pageNumber]: texts });
}

function recordEdit(history: StrokeHistory, pageNumber: number, strokesByPage: Strokes, textsByPage: TextNotesByPage): StrokeHistory {
  const edit = { before: history.strokesByPage, after: strokesByPage,
    beforeTexts: history.textsByPage, afterTexts: textsByPage, pageNumber };
  return {
    strokesByPage, textsByPage,
    past: [...history.past, edit].slice(-STROKE_HISTORY_LIMIT),
    future: [],
    changedPage: pageNumber,
    version: history.version + 1,
  };
}

export function undoStrokeEdit(history: StrokeHistory): StrokeHistory {
  const edit = history.past.at(-1);
  if (!edit) return history;
  return {
    strokesByPage: edit.before,
    textsByPage: edit.beforeTexts,
    past: history.past.slice(0, -1),
    future: [...history.future, edit],
    changedPage: edit.pageNumber,
    version: history.version + 1,
  };
}

export function redoStrokeEdit(history: StrokeHistory): StrokeHistory {
  const edit = history.future.at(-1);
  if (!edit) return history;
  return {
    strokesByPage: edit.after,
    textsByPage: edit.afterTexts,
    past: [...history.past, edit],
    future: history.future.slice(0, -1),
    changedPage: edit.pageNumber,
    version: history.version + 1,
  };
}
