// 表示だけの設定。ページID・ノートの保存データは変更しない。
export const SPREAD_MEDIA_QUERY = "(min-width: 1000px) and (min-height: 600px)";

export function visiblePageNumbers(current: number, count: number, spread: boolean): number[] {
  if (count < 1) return [];
  const page = Math.max(1, Math.min(count, current));
  const first = spread ? page - (page - 1) % 2 : page;
  return spread && first < count ? [first, first + 1] : [first];
}

export function adjacentPageNumber(current: number, count: number, spread: boolean, direction: -1 | 1): number {
  const visible = visiblePageNumbers(current, count, spread);
  if (!visible.length) return 1;
  return Math.max(1, Math.min(count, direction < 0 ? visible[0] - (spread ? 2 : 1) : visible.at(-1)! + 1));
}
