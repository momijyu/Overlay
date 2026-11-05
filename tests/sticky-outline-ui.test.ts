import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StickyNotesPanel } from "@/features/pdf-editor/components/StickyNotesPanel";
import type { SavedNoteSummary } from "@/features/pdf-editor/types";

function buttons(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<Record<string, unknown>>(child)) return [];
    return [...(child.type === "button" ? [child] : []), ...buttons(child.props.children as React.ReactNode)];
  });
}
const notes: SavedNoteSummary[] = [{ id: "a", title: "資料A", fileName: "a.pdf", folderId: null, updatedAt: "date",
  stickyNotes: [{ pageId: 8, pageNumber: 3, textId: "sticky", label: "試験に出る" },
    { pageId: 8, pageNumber: 3, textId: "another", label: "友達に質問" }] }];

test("付箋一覧は資料名・ページ・先頭行を表示し、同ページの複数付箋も別の入口にする", () => {
  const calls: unknown[][] = [];
  const panel = StickyNotesPanel({ notes, disabled: false, onNavigate: (...args) => calls.push(args) });
  const html = renderToStaticMarkup(panel);
  for (const label of ["付箋一覧", "資料A", "3ページ", "試験に出る", "友達に質問"]) assert.ok(html.includes(label));
  assert.equal(buttons(panel).length, 2);
  (buttons(panel)[0].props.onClick as () => void)();
  assert.deepEqual(calls, [[notes[0], 8, "sticky"]]);
});

test("処理中は移動せず、空の一覧・未保存の開いた資料にも対応する", () => {
  let calls = 0;
  const current = { id: null, title: "未保存の資料", entries: notes[0].stickyNotes! };
  const panel = StickyNotesPanel({ notes: [], current, currentPageId: 8, disabled: true, onNavigate: () => calls++ });
  assert.equal(buttons(panel)[0].props.disabled, true);
  assert.equal(buttons(panel)[0].props["aria-current"], "page");
  (buttons(panel)[0].props.onClick as () => void)(); assert.equal(calls, 0);
  assert.ok(renderToStaticMarkup(StickyNotesPanel({ notes: [], disabled: false, onNavigate: () => {} })).includes("付箋はありません。"));
});
