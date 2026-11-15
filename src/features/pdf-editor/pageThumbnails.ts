import type { NotePage } from "./types";

export const THUMBNAIL_WIDTH = 128;
export const THUMBNAIL_HEIGHT = 136;
export const THUMBNAIL_ROW_HEIGHT = 168;
export const THUMBNAIL_CACHE_LIMIT = 24;
export const THUMBNAIL_MEDIA_QUERY = "(min-width: 640px) and (hover: hover) and (pointer: fine)";

export function thumbnailWindow(scrollTop: number, height: number, count: number) {
  const start = Math.max(0, Math.min(count, Math.floor(scrollTop / THUMBNAIL_ROW_HEIGHT) - 1));
  const end = Math.min(count, Math.ceil((scrollTop + height) / THUMBNAIL_ROW_HEIGHT) + 1);
  return { start, end: Math.max(start, end) };
}

export function thumbnailKey(page: NotePage) {
  return page.kind === "pdf" ? `pdf:${page.pageNumber}`
    : `blank:${page.width}:${page.height}:${page.template ?? "plain"}`;
}

// PDFの背景だけを少数保持する。書き込みはこのキャッシュに含めず、確定した最新状態を重ねる。
// 同時描画は1件。画面外へ出た要求は待機中・描画中とも取り消せる。
export function createThumbnailQueue<T>(render: (page: NotePage, signal: AbortSignal) => Promise<T>) {
  const cache = new Map<string, T>();
  let tail = Promise.resolve();
  return {
    get(page: NotePage, signal: AbortSignal): Promise<T> {
      const task = tail.then(async () => {
        signal.throwIfAborted();
        const key = thumbnailKey(page);
        if (cache.has(key)) {
          const value = cache.get(key)!;
          cache.delete(key); cache.set(key, value);
          return value;
        }
        const value = await render(page, signal);
        signal.throwIfAborted();
        cache.set(key, value);
        if (cache.size > THUMBNAIL_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
        return value;
      });
      tail = task.then(() => {}, () => {});
      return task;
    },
  };
}
