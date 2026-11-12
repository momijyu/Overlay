import { MAX_NOTE_PAGES } from "./notePages";

// ページIDではなく、白紙・削除を反映した現在の表示順で指定する。
export function validatePdfPageSelection(numbers: readonly number[], pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MAX_NOTE_PAGES
    || !Array.isArray(numbers) || !numbers.length || numbers.length > MAX_NOTE_PAGES
    || Array.from(numbers).some((number) => !Number.isSafeInteger(number) || number < 1 || number > pageCount)) {
    throw new Error(`1〜${pageCount}ページの範囲で指定してください。`);
  }
  return [...new Set(numbers)].sort((a, b) => a - b);
}

export function parsePdfPageSelection(input: string, pageCount: number): number[] {
  if (input.length > MAX_NOTE_PAGES * 6) throw new Error("ページの指定が長すぎます。");
  const normalized = input.normalize("NFKC").replaceAll("、", ",").trim();
  if (!normalized) throw new Error("出力するページを指定してください。");
  const numbers = new Set<number>();
  for (const part of normalized.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw new Error("ページは「1, 3-5」の形式で指定してください。");
    const start = Number(match[1]), end = Number(match[2] ?? match[1]);
    validatePdfPageSelection([start, end], pageCount);
    if (start > end) throw new Error("範囲は小さいページから指定してください。");
    for (let page = start; page <= end; page++) numbers.add(page);
  }
  return validatePdfPageSelection([...numbers], pageCount);
}
