import type { BlankPageTemplate, NotePage } from "./types";

export const MAX_NOTE_PAGES = 10_000;
function invalid(): never { throw new Error("ノートのページ構成が不正です。"); }

// 残した元ページは元の順序とIDを保持する。削除しても後続ページを振り直さない。
export function readNotePages(value: unknown): NotePage[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.length > MAX_NOTE_PAGES) invalid();
  const ids = new Set<number>();
  let lastOriginal = 0;
  const pages = Array.from(value, (item): NotePage => {
    if (!item || typeof item !== "object" || !Number.isSafeInteger(item.id) || item.id < 1 || ids.has(item.id)) invalid();
    ids.add(item.id);
    if (item.kind === "pdf") {
      if (!Number.isSafeInteger(item.pageNumber) || item.pageNumber <= lastOriginal || item.id !== item.pageNumber) invalid();
      lastOriginal = item.pageNumber;
      return { id: item.id, kind: "pdf", pageNumber: item.pageNumber };
    }
    if (item.kind !== "blank" || !Number.isFinite(item.width) || !Number.isFinite(item.height)
      || item.width <= 0 || item.height <= 0 || item.width > 14_400 || item.height > 14_400) invalid();
    if (item.template !== undefined && item.template !== "plain" && item.template !== "ruled" && item.template !== "grid") invalid();
    // 無地は旧データと同じ形へ正規化し、既存ノートの重複判定を変えない。
    return { id: item.id, kind: "blank", width: item.width, height: item.height,
      ...(item.template && item.template !== "plain" ? { template: item.template } : {}) };
  });
  if (pages.some((page) => page.kind === "blank" && page.id <= lastOriginal)) invalid();
  return pages;
}

export function resolveNotePages(pages: NotePage[] | undefined, originalCount: number): NotePage[] {
  if (!Number.isSafeInteger(originalCount) || originalCount < 1 || originalCount > MAX_NOTE_PAGES) invalid();
  if (pages) {
    const checked = readNotePages(pages)!;
    if (checked.some((page) => page.kind === "pdf" ? page.pageNumber > originalCount : page.id <= originalCount)) invalid();
    return checked;
  }
  return Array.from({ length: originalCount }, (_, index) => ({ id: index + 1, kind: "pdf", pageNumber: index + 1 }));
}

export function checkPageBindings(pages: NotePage[] | undefined, maps: Record<number, unknown>[], originalCount?: number) {
  const checked = originalCount === undefined ? readNotePages(pages) : resolveNotePages(pages, originalCount);
  const ids = checked && new Set(checked.map((page) => page.id));
  for (const map of maps) for (const key of Object.keys(map)) {
    const id = Number(key);
    if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(id) || (ids && !ids.has(id))) {
      throw new Error("書き込み情報のページがノートと一致しません。");
    }
  }
}

export function insertBlankPage(pages: NotePage[], afterId: number, width: number, height: number, originalCount = 0, template: BlankPageTemplate = "plain"): NotePage[] {
  if (pages.length >= MAX_NOTE_PAGES) throw new Error("ページは10,000枚まで追加できます。");
  const index = pages.findIndex((page) => page.id === afterId);
  if (index < 0) invalid();
  const id = Math.max(originalCount, ...pages.map((page) => page.id)) + 1;
  return readNotePages([...pages.slice(0, index + 1), { id, kind: "blank", width, height, template }, ...pages.slice(index + 1)])!;
}

export function deleteNotePage(pages: NotePage[], pageId: number): NotePage[] {
  const checked = readNotePages(pages)!;
  if (!checked.some((page) => page.id === pageId)) invalid();
  if (checked.length === 1) throw new Error("最後の1ページは削除できません。");
  return checked.filter((page) => page.id !== pageId);
}
