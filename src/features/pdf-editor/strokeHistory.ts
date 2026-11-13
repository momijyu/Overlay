import { pruneImages } from "./imageData";
import type { NoteImages } from "./types";
import { changePageHeading } from "./pageHeadings";
import { deleteNotePage } from "./notePages";
import type { HeadingsByPage, NotePage, PenStroke, TextNote, TextNotesByPage } from "./types";

type Strokes = Record<number, PenStroke[]>;
type StrokeEdit = {
  before: Strokes; after: Strokes;
  beforeImages?: NoteImages; afterImages?: NoteImages;
  beforeTexts: TextNotesByPage; afterTexts: TextNotesByPage;
  beforeHeadings: HeadingsByPage; afterHeadings: HeadingsByPage;
  beforePages?: NotePage[]; afterPages?: NotePage[];
  // 戻す／やり直す際に表示するページID。挿入時は前後で異なる。
  beforePage: number; pageNumber: number;
};
export type StrokeHistory = {
  strokesByPage: Strokes;
  images?: NoteImages;
  textsByPage: TextNotesByPage;
  headingsByPage: HeadingsByPage;
  pages?: NotePage[];
  past: StrokeEdit[];
  future: StrokeEdit[];
  changedPage: number | null;
  version: number;
};

export const STROKE_HISTORY_LIMIT = 100;

export function createStrokeHistory(strokesByPage: Strokes, textsByPage: TextNotesByPage = {}, pages?: NotePage[], headingsByPage: HeadingsByPage = {}, images?: NoteImages): StrokeHistory {
  return { strokesByPage, textsByPage, pages, headingsByPage, images, past: [], future: [], changedPage: null, version: 0 };
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

// 投げ縄の移動・複製は線と文章を同時に変えても1操作にまとめる。
export function recordAnnotationEdit(history: StrokeHistory, pageNumber: number, strokes: PenStroke[], texts: TextNote[]): StrokeHistory {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) return history;
  const sameStrokes = history.strokesByPage[pageNumber] === strokes || (!history.strokesByPage[pageNumber] && !strokes.length);
  const sameTexts = history.textsByPage[pageNumber] === texts || (!history.textsByPage[pageNumber] && !texts.length);
  if (sameStrokes && sameTexts) return history;
  return recordEdit(history, pageNumber, sameStrokes ? history.strokesByPage : { ...history.strokesByPage, [pageNumber]: strokes },
    sameTexts ? history.textsByPage : { ...history.textsByPage, [pageNumber]: texts });
}

function recordEdit(history: StrokeHistory, pageNumber: number, strokesByPage: Strokes, textsByPage: TextNotesByPage,
  change?: { pageChange?: { before: NotePage[]; after: NotePage[]; previousId: number }; headingsByPage?: HeadingsByPage; images?: NoteImages }): StrokeHistory {
  const pageChange = change?.pageChange;
  const images = change?.images ?? history.images;
  const headingsByPage = change?.headingsByPage ?? history.headingsByPage;
  const pages = pageChange?.after ?? history.pages;
  const beforePages = pageChange?.before ?? history.pages;
  const beforePage = pageChange?.previousId ?? pageNumber;
  const edit = { before: history.strokesByPage, after: strokesByPage,
    beforeImages: history.images, afterImages: images, beforeTexts: history.textsByPage, afterTexts: textsByPage, beforeHeadings: history.headingsByPage, afterHeadings: headingsByPage, pageNumber, beforePages, afterPages: pages, beforePage };
  return {
    strokesByPage, textsByPage, pages, headingsByPage, images,
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
    images: edit.beforeImages,
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
    images: edit.afterImages,
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
  return recordEdit(history, insertedId, history.strokesByPage, history.textsByPage, { pageChange: { before, after, previousId } });
}

export function recordHeadingEdit(history: StrokeHistory, pageId: number, value: string): StrokeHistory {
  const headingsByPage = changePageHeading(history.headingsByPage, pageId, value);
  if (headingsByPage === history.headingsByPage) return history;
  return recordEdit(history, pageId, history.strokesByPage, history.textsByPage, { headingsByPage });
}

export type PageClearSelection = { strokes: boolean; sticky: boolean; text: boolean };

export function pageAnnotationCounts(history: StrokeHistory, pageId: number) {
  const texts = history.textsByPage[pageId] ?? [];
  return { strokes: history.strokesByPage[pageId]?.length ?? 0,
    sticky: texts.filter((note) => note.kind === "sticky").length,
    text: texts.filter((note) => note.kind === "text").length };
}

// 複数種類の削除も1操作として戻す。別ページ・旧見出し・元PDFは変更しない。
export function recordPageClear(history: StrokeHistory, pageId: number, selection: PageClearSelection): StrokeHistory {
  const counts = pageAnnotationCounts(history, pageId);
  if (!Number.isSafeInteger(pageId) || pageId < 1
    || !Object.entries(counts).some(([key, count]) => selection[key as keyof PageClearSelection] && count > 0)) return history;
  const strokes = selection.strokes && counts.strokes ? { ...history.strokesByPage, [pageId]: [] } : history.strokesByPage;
  const texts = (counts.sticky > 0 && selection.sticky) || (counts.text > 0 && selection.text)
    ? { ...history.textsByPage, [pageId]: (history.textsByPage[pageId] ?? []).filter((note) => !selection[note.kind]) }
    : history.textsByPage;
  return recordEdit(history, pageId, strokes, texts);
}

export function recordPageDeletion(history: StrokeHistory, before: NotePage[], pageId: number): StrokeHistory {
  const after = deleteNotePage(before, pageId);
  const index = before.findIndex((page) => page.id === pageId);
  const destination = after[Math.min(index, after.length - 1)].id;
  const strokesByPage = { ...history.strokesByPage }; delete strokesByPage[pageId];
  const textsByPage = { ...history.textsByPage }; delete textsByPage[pageId];
  const headingsByPage = { ...history.headingsByPage }; delete headingsByPage[pageId];
  return recordEdit(history, destination, strokesByPage, textsByPage,
    { pageChange: { before, after, previousId: pageId }, headingsByPage, ...(history.images ? { images: pruneImages({ assets: history.images.assets, byPage: Object.fromEntries(Object.entries(history.images.byPage).filter(([id]) => Number(id) !== pageId)) }) } : {}) });
}

export function recordImageEdit(history: StrokeHistory, pageId: number, images: NoteImages): StrokeHistory {
  if (images === history.images) return history;
  return recordEdit(history, pageId, history.strokesByPage, history.textsByPage, { images: pruneImages(images) });
}
