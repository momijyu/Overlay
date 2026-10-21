import assert from "node:assert/strict";
import test from "node:test";
import { createElement, isValidElement, Children, type ReactNode, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NotebookActionDialog, type NotebookAction } from "@/features/pdf-editor/components/NotebookActionDialog";
import { NotebookTree, type NotebookTreeProps } from "@/features/pdf-editor/components/NotebookTree";
import { PdfWorkspace } from "@/features/pdf-editor/components/PdfWorkspace";
import { NotebookSidebar } from "@/features/pdf-editor/components/NotebookSidebar";
import { buildNoteTree, folderChoices } from "@/features/pdf-editor/noteTree";
import type { NoteLibrary } from "@/features/pdf-editor/types";
import { canMoveItem } from "@/features/pdf-editor/noteDrag";
import Home from "@/app/page";

const library: NoteLibrary = {
  foldersEnabled: true,
  folders: [
    { id: "year", name: "2026", parentId: null },
    { id: "subject", name: "情報", parentId: "year" },
    { id: "other", name: "2027", parentId: null },
  ],
  notes: [{ id: "note", title: "ノート1", fileName: "sample.pdf", updatedAt: "2026-10-12", folderId: "subject" }],
};

test("編集画面はサーバー描画でIndexedDBを開かず、定期的なPDF保管だけを案内する", () => {
  const html = renderToStaticMarkup(createElement(PdfWorkspace));
  assert.match(html, /重要なノートは定期的に『PDFをダウンロード』して保管してください/);
  const notice = html.match(/<p[^>]*data-pdf-backup-notice[^>]*>[\s\S]*?<\/p>/)![0];
  assert.match(notice, /class="text-sm text-red-400"/);
  assert.match(notice, />※ 重要なノートは/);
  assert.doesNotMatch(html, /保存先はこのブラウザ|最初の線を描き終えた時から自動保存|PDFを開いただけでは保存しません/);
  assert.doesNotMatch(html, /別の端末・ブラウザ・URL|サイトデータを削除すると|一定期間アクセスがないと|iOS Safari/);
  assert.doesNotMatch(html, /以前のSupabase|以前のノート|移行と再編集用バックアップ|編集履歴は直近/);
  assert.match(html, /id="pdf-upload"/);
});

test("初期画面のヘッダーは1つで、Overlayの左に一覧ボタンを置き、PDFの選択操作も維持する", () => {
  const html = renderToStaticMarkup(createElement(Home));
  assert.equal((html.match(/<header\b/g) ?? []).length, 1);
  assert.equal((html.match(/<main\b/g) ?? []).length, 1);
  const header = html.match(/<header\b[\s\S]*?<\/header>/)![0];
  assert.ok(header.indexOf('aria-label="ノート一覧を開く"') < header.indexOf(">Overlay<"));
  assert.match(header, /aria-expanded="false"/);
  assert.match(html, /id="pdf-upload"/);
  assert.match(html, /PDFを追加/);
  assert.equal((html.match(/重要なノートは定期的に/g) ?? []).length, 1);
});

test("未選択・読み込み中・他操作中も操作メニュー自体は有効で、未選択の案内を出す", () => {
  for (const disabled of [false, true]) {
    const html = renderToStaticMarkup(createElement(NotebookSidebar, {
      refreshVersion: 0, currentNoteId: null, disabled,
      onOpen: () => {}, onRenamed: () => {}, onDelete: async () => {}, onMutationChange: () => {},
    }));
    const summary = html.match(/<summary[^>]*>操作<\/summary>/)?.[0];
    assert.ok(summary);
    assert.doesNotMatch(summary, /disabled|tabindex/i);
    assert.match(html, /class="relative flex min-w-0 gap-2" data-notebook-actions/);
    assert.match(html, /<details class="dropdown static">/);
    const menu = html.match(/<ul class="menu dropdown-content[^>]+>/)![0];
    assert.match(menu, /start-0/);
    assert.match(menu, /w-full min-w-0 max-w-64/);
    assert.match(menu, /\[&amp;_button\]:whitespace-normal/);
    assert.match(menu, /\[&amp;_button\]:break-words/);
    assert.match(html, /<button[^>]*disabled="">ノートまたはフォルダを選択してください<\/button>/);
  }
});

function dialog(action: NotebookAction, busy = false, error: string | null = null, dialogLibrary = library) {
  return renderToStaticMarkup(createElement(NotebookActionDialog, {
    action, library: dialogLibrary, busy, error, onClose: () => {}, onSubmit: async () => {},
  }));
}

test("ノート・フォルダの管理画面はサイドメニューの片側角丸を使わず、四隅を統一する", () => {
  const actions: NotebookAction[] = [
    { kind: "create-folder", parentId: null },
    { kind: "edit-note", note: library.notes[0] },
    { kind: "delete-note", note: library.notes[0] },
    { kind: "move-folder", folder: library.folders[1] },
    { kind: "rename-folder", folder: library.folders[1] },
    { kind: "delete-folder", folder: library.folders[2] },
  ];
  for (const action of actions) {
    const html = dialog(action);
    assert.match(html, /<div class="modal-box max-w-md rounded-box">/);
    assert.doesNotMatch(html, /modal-start|rounded-none/);
  }
});

test("ノート削除は対象名と取り消せない確認を表示し、名前・移動先入力を出さない", () => {
  const action: NotebookAction = { kind: "delete-note", note: library.notes[0] };
  const html = dialog(action);
  assert.match(html, /ノート削除/);
  assert.match(html, /ノート1/);
  assert.match(html, /元PDFと書き込みをブラウザ内から削除します。元に戻せません/);
  assert.match(html, /未保存の変更も失われます/);
  assert.match(html, /btn-error/);
  assert.doesNotMatch(html, /<input|<select|type="submit"[^>]*disabled=""/);
  const busy = dialog(action, true);
  assert.match(busy, /削除中…/);
  assert.match(busy, /type="button"[^>]*disabled=""/);
  assert.match(busy, /type="submit" disabled=""/);
  const failed = dialog(action, false, "削除に失敗しました。");
  assert.match(failed, /role="alert">削除に失敗しました。/);
  assert.match(failed, /ノート1/);
});

test("確認中に一覧から消えたノートの削除は送信できない", () => {
  const html = dialog({ kind: "delete-note", note: library.notes[0] }, false, null, { ...library, notes: [] });
  assert.match(html, /削除するノートが見つかりません/);
  assert.match(html, /type="submit"[^>]*disabled=""/);
});

test("フォルダ作成のダイアログは選んだ親を初期選択する", () => {
  const html = dialog({ kind: "create-folder", parentId: "subject" });
  assert.match(html, /<dialog[^>]*class="modal"/);
  assert.match(html, /value="subject" selected=""/);
  assert.match(html, /2026 \/ 情報/);
  assert.match(html, /キャンセル/);
});

test("フォルダ名変更は元の名前だけを表示し、同じ名前のまま送信しない", () => {
  const html = dialog({ kind: "rename-folder", folder: library.folders[1] });
  assert.match(html, /フォルダ名変更/);
  assert.match(html, /value="情報"/);
  assert.match(html, /maxLength="100"/);
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /type="submit"[^>]*disabled=""/);
  assert.doesNotMatch(html, /同じ名前のフォルダがあります/);
  const busy = dialog({ kind: "rename-folder", folder: library.folders[1] }, true, "通信に失敗しました。");
  assert.match(busy, /<input[^>]*disabled=""/);
  assert.match(busy, /role="alert">通信に失敗しました。/);
});

test("空フォルダの削除には確認を表示し、子・ノートがあると送信できない", () => {
  const empty = dialog({ kind: "delete-folder", folder: library.folders[2] });
  assert.match(empty, /空フォルダ削除/);
  assert.match(empty, /この空フォルダを削除します。元に戻せません。/);
  assert.match(empty, /btn-error/);
  assert.doesNotMatch(empty, /<input|<select|type="submit"[^>]*disabled=""/);
  for (const folder of library.folders.slice(0, 2)) {
    const html = dialog({ kind: "delete-folder", folder });
    assert.match(html, /空のフォルダだけ削除できます/);
    assert.match(html, /type="submit"[^>]*disabled=""/);
  }
  const unknown = dialog({ kind: "delete-folder", folder: { id: "missing", name: "不明", parentId: null } });
  assert.match(unknown, /type="submit"[^>]*disabled=""/);
});

test("削除中は閉じるボタンを無効にし、失敗時は確認と理由を残す", () => {
  const action: NotebookAction = { kind: "delete-folder", folder: library.folders[2] };
  const busy = dialog(action, true);
  assert.match(busy, /削除中…/);
  assert.match(busy, /type="button"[^>]*disabled=""/);
  assert.match(busy, /aria-label="閉じる"/);
  assert.match(busy, /type="submit" disabled=""/);
  const failed = dialog(action, false, "フォルダを削除できませんでした。");
  assert.match(failed, /role="alert">フォルダを削除できませんでした。/);
  assert.match(failed, /2027/);
});

test("フォルダ移動の候補から同名衝突を除外し、最上位の衝突も無効化", () => {
  const moving = { id: "moving", name: "Docs", parentId: "subject" };
  const collisionLibrary: NoteLibrary = { ...library, folders: [
    ...library.folders, moving,
    { id: "root-copy", name: "docs", parentId: null },
    { id: "other-copy", name: "DOCS", parentId: "other" },
  ] };
  const html = dialog({ kind: "move-folder", folder: moving }, false, null, collisionLibrary);
  assert.match(html, /option value="root" disabled=""/);
  assert.doesNotMatch(html, /option value="other"/);
  assert.match(html, /option value="year"/);
  assert.match(html, /value="subject" disabled="" selected=""/);
});

test("同名衝突で無効な子要素ドロップは親へ伝わらずAPI呼び出しをしない", () => {
  const moving = { id: "moving", name: "docs", parentId: null };
  const collisionLibrary: NoteLibrary = { ...library, folders: [...library.folders, moving,
    { id: "copy", name: "Docs", parentId: "subject" },
  ] };
  let calls = 0;
  const item = { kind: "folder" as const, id: moving.id };
  const tree = createElement("ul", { onDrop: () => { calls++; } }, createElement(NotebookTree, treeProps({
    tree: buildNoteTree(collisionLibrary.folders, collisionLibrary.notes),
    onDrop: (_event, parentId) => { if (canMoveItem(item, parentId, collisionLibrary)) calls++; },
  })));
  bubble(elementPath(tree, (entry) => entry.type === "button" && entry.props.title === "ノート1"), "onDrop");
  assert.equal(calls, 0);
});

test("ノート整理は元の名前・保存先を維持して表示する", () => {
  const html = dialog({ kind: "edit-note", note: library.notes[0] });
  assert.match(html, /value="ノート1"/);
  assert.match(html, /value="subject" selected=""/);
  assert.match(html, /ノート名・フォルダ/);
  assert.doesNotMatch(html, /保存先|最上位/);
});

test("フォルダ移動は現在の場所を説明し、自己・子孫を候補にしない", () => {
  const html = dialog({ kind: "move-folder", folder: library.folders[0] });
  assert.match(html, /一番上（現在）/);
  assert.match(html, /別の移動先を選択してください。/);
  assert.match(html, /type="submit"[^>]*disabled=""/);
  assert.doesNotMatch(html, /option value="year"|option value="subject"/);
  assert.match(html, /option value="other"/);
  assert.doesNotMatch(html, /移動するフォルダ/);
});

test("子フォルダの移動では現在の親を残し、最上位も候補にする", () => {
  const html = dialog({ kind: "move-folder", folder: library.folders[1] });
  assert.match(html, /value="year" disabled="" selected=""/);
  assert.match(html, /2026（現在）/);
  assert.match(html, /option value="root">一番上/);
});

test("移動先が存在しない場合は別フォルダの作成を案内する", () => {
  const html = renderToStaticMarkup(createElement(NotebookActionDialog, {
    action: { kind: "move-folder", folder: library.folders[0] },
    library: { ...library, folders: library.folders.slice(0, 2) },
    busy: false, error: null, onClose: () => {}, onSubmit: async () => {},
  }));
  assert.match(html, /移動先がありません。先に別のフォルダを作成してください。/);
});

test("保存中はフォームを無効化し、失敗時の理由はダイアログに表示する", () => {
  const action: NotebookAction = { kind: "edit-note", note: library.notes[0] };
  const html = dialog(action, true);
  assert.match(html, /<input[^>]*disabled=""/);
  assert.match(html, /<select[^>]*disabled=""/);
  assert.match(html, /type="button"[^>]*disabled=""/);
  assert.match(html, /保存中…/);
  assert.match(dialog(action, false, "保存できませんでした。"), /role="alert">保存できませんでした。/);
});

function treeProps(overrides: Partial<NotebookTreeProps> = {}): NotebookTreeProps {
  return {
    tree: buildNoteTree(library.folders, library.notes), currentNoteId: "note", selected: null,
    disabled: false, expanded: new Set(["year", "subject"]), dragEnabled: true,
    dragging: null, dropTarget: null, onSelect: () => {}, onOpen: () => {}, onToggle: () => {},
    onDragStart: () => {}, onDragEnd: () => {}, onDragOver: () => {}, onDragLeave: () => {}, onDrop: () => {},
    ...overrides,
  };
}

test("一覧は名前を直接操作でき、選択・移動先を強調する", () => {
  const html = renderToStaticMarkup(createElement(NotebookTree, treeProps({
    selected: { kind: "folder", id: "subject" }, dropTarget: "subject",
  })));
  assert.match(html, /bg-base-200/);
  assert.match(html, /outline-primary/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /draggable="true"/);
  assert.doesNotMatch(html, /このノートを表示|>開く</);
  const busyHtml = renderToStaticMarkup(createElement(NotebookTree, treeProps({ disabled: true })));
  assert.doesNotMatch(busyHtml, /draggable="true"/);
});

// 副作用なしのツリーについて、HTMLだけでなくイベントの接続先も確認する。
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    if (child.type === NotebookTree) return elements(NotebookTree(child.props as NotebookTreeProps));
    return [child, ...elements(child.props.children as ReactNode)];
  });
}

test("フォルダを選択でき、開いているノートは再読み込みしない", () => {
  const selected: unknown[] = [];
  const opened: unknown[] = [];
  const entries = elements(NotebookTree(treeProps({ onSelect: (item) => selected.push(item), onOpen: (note) => opened.push(note) })));
  const summary = entries.find((entry) => entry.type === "summary" && entry.props.title === "情報")!;
  (summary.props.onClick as (event: { preventDefault(): void }) => void)({ preventDefault() {} });
  const button = entries.find((entry) => entry.type === "button")!;
  (button.props.onClick as () => void)();
  assert.deepEqual(selected, [{ kind: "folder", id: "subject" }, { kind: "note", id: "note" }]);
  assert.deepEqual(opened, []);
});

test("別のノートを選ぶと読み込み、処理中のクリックでは選択しない", () => {
  let opened = 0;
  let selected = 0;
  const props = treeProps({ currentNoteId: null, onOpen: () => { opened++; }, onSelect: () => { selected++; } });
  const button = elements(NotebookTree(props)).find((entry) => entry.type === "button")!;
  (button.props.onClick as () => void)();
  assert.equal(opened, 1);
  assert.equal(selected, 1);
  const busy = elements(NotebookTree({ ...props, disabled: true }));
  (busy.find((entry) => entry.type === "button")!.props.onClick as () => void)();
  let prevented = false;
  (busy.find((entry) => entry.type === "summary")!.props.onClick as (event: { preventDefault(): void }) => void)({ preventDefault() { prevented = true; } });
  assert.equal(opened, 1);
  assert.equal(selected, 1);
  assert.equal(prevented, true);
});

test("親ごとに子一覧を入れ子にし、ガイド線用のクラスを付ける", () => {
  const entries = elements(NotebookTree(treeProps()));
  const yearDetails = entries.find((entry) => entry.type === "details")!;
  const yearChildren = Children.toArray(yearDetails.props.children as ReactNode);
  const childList = yearChildren.find((child) => isValidElement(child) && child.type === "ul");
  assert.ok(isValidElement<Record<string, unknown>>(childList));
  assert.equal(childList.props.className, "notebook-children");
  const descendants = elements(childList.props.children as ReactNode);
  assert.ok(descendants.some((entry) => entry.type === "summary" && entry.props.title === "情報"));
  assert.ok(descendants.some((entry) => entry.type === "button" && entry.props.title === "ノート1"));
  assert.ok(!descendants.some((entry) => entry.type === "summary" && entry.props.title === "2027"));
});

test("フォルダとノートの名前に共通の配置と省略用の要素を使う", () => {
  const entries = elements(NotebookTree(treeProps()));
  const folder = entries.find((entry) => entry.type === "summary" && entry.props.title === "情報")!;
  const note = entries.find((entry) => entry.type === "button")!;
  assert.match(folder.props.className as string, /notebook-row notebook-folder/);
  assert.match(note.props.className as string, /notebook-row/);
  for (const row of [folder, note]) {
    assert.ok(isValidElement<Record<string, unknown>>(row.props.children));
    assert.equal(row.props.children.props.className, "notebook-label");
  }
  const longTitle = "長いノート名".repeat(15);
  const html = renderToStaticMarkup(createElement(NotebookTree, treeProps({
    tree: { folders: [], notes: [{ ...library.notes[0], title: longTitle }] },
  })));
  assert.ok(html.includes(`title="${longTitle}"`));
  assert.ok(html.includes(`<span class="notebook-label">${longTitle}</span>`));
});

test("空フォルダに余分な行・ガイド線を作らず、開閉とドラッグを維持する", () => {
  const toggles: unknown[] = [];
  const dragged: unknown[] = [];
  const entries = elements(NotebookTree(treeProps({
    onToggle: (id, open) => toggles.push({ id, open }),
    onDragStart: (_event, item) => dragged.push(item),
  })));
  const details = entries.find((entry) => entry.type === "details")!;
  (details.props.onToggle as (event: { currentTarget: { open: boolean } }) => void)({ currentTarget: { open: false } });
  const folder = entries.find((entry) => entry.type === "summary" && entry.props.title === "情報")!;
  (folder.props.onDragStart as (event: unknown) => void)({});
  assert.deepEqual(toggles, [{ id: "year", open: false }]);
  assert.deepEqual(dragged, [{ kind: "folder", id: "subject" }]);
  const emptyTree = treeProps({
    tree: buildNoteTree(library.folders, []),
  });
  const html = renderToStaticMarkup(createElement(NotebookTree, emptyTree));
  assert.doesNotMatch(html, /空のフォルダ/);
  const emptyDetails = elements(NotebookTree(emptyTree)).find((entry) => entry.type === "details" &&
    elements(entry.props.children as ReactNode).some((child) => child.type === "summary" && child.props.title === "情報"));
  assert.ok(emptyDetails);
  // 内側の「情報」にはsummaryしかなく、空の子一覧を描画しない。
  const subject = elements(emptyDetails.props.children as ReactNode).find((entry) => entry.type === "details");
  assert.ok(subject);
  assert.ok(!elements(subject.props.children as ReactNode).some((entry) => entry.type === "ul"));
});

test("保存先の表示用パスは移動・名前変更後の階層から作る", () => {
  const path = (folders: NoteLibrary["folders"]) => folderChoices(buildNoteTree(folders, library.notes))
    .find((folder) => folder.id === library.notes[0].folderId)?.path ?? "最上位";
  assert.equal(path(library.folders), "2026 / 情報");
  assert.equal(path(library.folders.map((folder) => folder.id === "subject"
    ? { ...folder, parentId: "other", name: "画像処理" } : folder)), "2027 / 画像処理");
  assert.equal(path([]), "最上位");
});

// DOMの親子順にイベントを渡し、stopPropagationで親の移動先へ届かないことを確認する。
function elementPath(node: ReactNode, match: (entry: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<Record<string, unknown>>(child)) continue;
    if (child.type === NotebookTree) {
      const path = elementPath(NotebookTree(child.props as NotebookTreeProps), match);
      if (path.length) return path;
      continue;
    }
    if (match(child)) return [child];
    const path = elementPath(child.props.children as ReactNode, match);
    if (path.length) return [child, ...path];
  }
  return [];
}

function bubble(path: ReactElement<Record<string, unknown>>[], name: "onDragOver" | "onDrop") {
  assert.ok(path.length > 0);
  let stopped = false;
  const event = { stopPropagation() { stopped = true; }, preventDefault() {} };
  for (const entry of [...path].reverse()) {
    const handler = entry.props[name] as ((receivedEvent: typeof event) => void) | undefined;
    handler?.(event);
    if (stopped) break;
  }
}

test("子のノート上で落とすと直接の親へ、最上位のノート上なら最上位へ送る", () => {
  const calls: (string | null)[] = [];
  const props = treeProps({
    tree: buildNoteTree(library.folders, [
      ...library.notes,
      { ...library.notes[0], id: "parent-note", title: "親直下のノート", folderId: "year" },
      { ...library.notes[0], id: "root-note", title: "最上位のノート", folderId: null },
    ]),
    onDragOver: (_event, id) => { calls.push(id); }, onDrop: (_event, id) => { calls.push(id); },
  });
  const root = createElement("ul", {
    onDragOver: () => { calls.push(null); }, onDrop: () => { calls.push(null); },
  }, createElement(NotebookTree, props));
  for (const [title, destination] of [["ノート1", "subject"], ["親直下のノート", "year"], ["最上位のノート", null]]) {
    const path = elementPath(root, (entry) => entry.type === "button" && entry.props.title === title);
    for (const event of ["onDragOver", "onDrop"] as const) {
      calls.length = 0;
      bubble(path, event);
      assert.deepEqual(calls, [destination]);
    }
  }
});

test("子フォルダ名・内部の余白は最も内側のフォルダを優先し、親へ重複通知しない", () => {
  const calls: (string | null)[] = [];
  const node = NotebookTree(treeProps({
    onDragOver: (_event, id) => { calls.push(id); }, onDrop: (_event, id) => { calls.push(id); },
  }));
  const paths = [
    elementPath(node, (entry) => entry.type === "summary" && entry.props.title === "情報"),
    elementPath(node, (entry) => entry.type === "ul" && Children.toArray(entry.props.children as ReactNode)
      .some((child) => isValidElement<NotebookTreeProps>(child) && child.type === NotebookTree
        && child.props.tree.notes.some((note) => note.id === "note"))),
  ];
  for (const path of paths) {
    for (const event of ["onDragOver", "onDrop"] as const) {
      calls.length = 0;
      bubble(path, event);
      assert.deepEqual(calls, ["subject"]);
    }
  }
});

test("移動先の強調は名前だけでなくフォルダ全体に付ける", () => {
  const entries = elements(NotebookTree(treeProps({ dropTarget: "subject" })));
  const targets = entries.filter((entry) => entry.props.className === "notebook-drop-target");
  assert.equal(targets.length, 1);
  assert.equal(targets[0].type, "li");
  assert.ok(elements(targets[0].props.children as ReactNode).some((entry) => entry.type === "summary" && entry.props.title === "情報"));
  assert.ok(elements(targets[0].props.children as ReactNode).some((entry) => entry.type === "button" && entry.props.title === "ノート1"));
});

test("自分の子要素への不正な移動を断っても、最上位へ勝手に移動しない", () => {
  const updates: (string | null)[] = [];
  const move = (destination: string | null) => {
    if (canMoveItem({ kind: "folder", id: "subject" }, destination, library)) updates.push(destination);
  };
  const node = createElement("ul", { onDrop: () => move(null) }, createElement(NotebookTree, treeProps({
    onDrop: (_event, destination) => move(destination),
  })));
  const path = elementPath(node, (entry) => entry.type === "button" && entry.props.title === "ノート1");
  bubble(path, "onDrop");
  assert.deepEqual(updates, []);
});
