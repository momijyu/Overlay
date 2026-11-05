import type { HeadingsByPage } from "./types";
import { MAX_NOTE_PAGES } from "./notePages";

export const MAX_HEADING_LENGTH = 120;

export function normalizeHeading(value: string): string {
  const heading = value.trim();
  if ([...heading].length > MAX_HEADING_LENGTH || /\p{Cc}|\p{Zl}|\p{Zp}/u.test(heading)) {
    throw new Error("見出しは改行なし・120文字以内で入力してください。");
  }
  return heading;
}

export function readPageHeadings(value: unknown): HeadingsByPage {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ページ見出しの形式が不正です。");
  const entries = Object.entries(value);
  if (entries.length > MAX_NOTE_PAGES) throw new Error("ページ見出しの数が多すぎます。");
  const checked: HeadingsByPage = {};
  for (const [key, raw] of entries) {
    if (!/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key)) || typeof raw !== "string") {
      throw new Error("ページ見出しの形式が不正です。");
    }
    const heading = normalizeHeading(raw);
    if (!heading) throw new Error("空のページ見出しは保存できません。");
    checked[Number(key)] = heading;
  }
  return checked;
}

export function changePageHeading(headings: HeadingsByPage, pageId: number, value: string): HeadingsByPage {
  if (!Number.isSafeInteger(pageId) || pageId < 1) throw new Error("見出しを付けるページが不正です。");
  const heading = normalizeHeading(value);
  if ((headings[pageId] ?? "") === heading) return headings;
  const next = { ...headings };
  if (heading) next[pageId] = heading;
  else delete next[pageId];
  return next;
}
