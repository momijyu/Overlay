import type { PenStroke } from "./types";

type Strokes = Record<number, PenStroke[]>;
type StrokeEdit = { before: Strokes; after: Strokes; pageNumber: number };
export type StrokeHistory = {
  strokesByPage: Strokes;
  past: StrokeEdit[];
  future: StrokeEdit[];
  changedPage: number | null;
  version: number;
};

export const STROKE_HISTORY_LIMIT = 100;

export function createStrokeHistory(strokesByPage: Strokes): StrokeHistory {
  return { strokesByPage, past: [], future: [], changedPage: null, version: 0 };
}

// 線の配列は描画・消去側も変更せず作り直すため、PDFや全座標を複製せず参照を保持できる。
export function recordStrokeEdit(history: StrokeHistory, pageNumber: number, strokes: PenStroke[]): StrokeHistory {
  const previous = history.strokesByPage[pageNumber];
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || previous === strokes
    || (!previous && strokes.length === 0)) return history;
  const next = { ...history.strokesByPage, [pageNumber]: strokes };
  const edit = { before: history.strokesByPage, after: next, pageNumber };
  return {
    strokesByPage: next,
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
    past: [...history.past, edit],
    future: history.future.slice(0, -1),
    changedPage: edit.pageNumber,
    version: history.version + 1,
  };
}
