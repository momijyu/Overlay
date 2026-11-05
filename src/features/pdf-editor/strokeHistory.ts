import { changePageHeading } from "./pageHeadings";
import type { HeadingsByPage, NotePage, PenStroke, TextNote, TextNotesByPage } from "./types";

type Strokes = Record<number, PenStroke[]>;
type StrokeEdit = {
  before: Strokes; after: Strokes;
  beforeTexts: TextNotesByPage; afterTexts: TextNotesByPage;
  beforeHeadings: HeadingsByPage; afterHeadings: HeadingsByPage;
  beforePages?: NotePage[]; afterPages?: NotePage[];
  // 戻す／やり直す際に表示するページID。挿入時は前後で異なる。
  beforePage: number; pageNumber: number;
};
export type StrokeHistory = {
  strokesByPage: Strokes;
  textsByPage: TextNotesByPage;
  headingsByPage: HeadingsByPage;
  pages?: NotePage[];
  past: StrokeEdit[];
  future: StrokeEdit[];
  changedPage: number | null;
  version: number;
};

export const STROKE_HISTORY_LIMIT = 100;

export function createStrokeHistory(strokesByPage: Strokes, textsByPage: TextNotesByPage = {}, pages?: NotePage[], headingsByPage: HeadingsByPage = {}): StrokeHistory {
  return { strokesByPage, textsByPage, pages, headingsByPage, past: [], future: [], changedPage: null, version: 0 };
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

function recordEdit(history: StrokeHistory, pageNumber: number, strokesByPage: Strokes, textsByPage: TextNotesByPage,
  change?: { insertion?: { before: NotePage[]; after: NotePage[]; previousId: number }; headingsByPage?: HeadingsByPage }): StrokeHistory {
  const insertion = change?.insertion;
  const headingsByPage = change?.headingsByPage ?? history.headingsByPage;
  const pages = insertion?.after ?? history.pages;
  const beforePages = insertion?.before ?? history.pages;
  const beforePage = insertion?.previousId ?? pageNumber;
  const edit = { before: history.strokesByPage, after: strokesByPage,
    beforeTexts: history.textsByPage, afterTexts: textsByPage, beforeHeadings: history.headingsByPage, afterHeadings: headingsByPage, pageNumber, beforePages, afterPages: pages, beforePage };
  return {
    strokesByPage, textsByPage, pages, headingsByPage,
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
    headingsByPage: edit.beforeHeadings,
    pages: edit.beforePages,
    past: history.past.slice(0, -1),
    future: [...history.future, edit],
    changedPage: edit.beforePage,
    version: history.version + 1,
  };
}

export function redoStrokeEdit(history: StrokeHistory): StrokeHistory {
  const edit = history.future.at(-1);
  if (!edit) return history;
  return {
    strokesByPage: edit.after,
    textsByPage: edit.afterTexts,
    headingsByPage: edit.afterHeadings,
    pages: edit.afterPages,
    past: [...history.past, edit],
    future: history.future.slice(0, -1),
    changedPage: edit.pageNumber,
    version: history.version + 1,
  };
}

export function recordPageInsertion(history: StrokeHistory, before: NotePage[], after: NotePage[], previousId: number, insertedId: number): StrokeHistory {
  return recordEdit(history, insertedId, history.strokesByPage, history.textsByPage, { insertion: { before, after, previousId } });
}

export function recordHeadingEdit(history: StrokeHistory, pageId: number, value: string): StrokeHistory {
  const headingsByPage = changePageHeading(history.headingsByPage, pageId, value);
  if (headingsByPage === history.headingsByPage) return history;
  return recordEdit(history, pageId, history.strokesByPage, history.textsByPage, { headingsByPage });
}
