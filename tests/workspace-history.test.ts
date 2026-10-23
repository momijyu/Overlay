import assert from "node:assert/strict";
import test, { beforeEach, mock } from "node:test";
import * as React from "react";
import { createLocalAutosave, type LocalSaveInput } from "@/features/pdf-editor/localAutosave";
import * as localNotes from "@/features/pdf-editor/localNotes";
import type { PenStroke, SavedNoteSummary, TextNotesByPage } from "@/features/pdf-editor/types";
import type { NoteDragItem } from "@/features/pdf-editor/noteDrag";

// Hooksの保持だけを代用し、Workspace内のイベント・状態・保存の接続を検証する。
// DOM・実際のReact再描画・ブラウザ操作を再現するテストではない。
const file = new File(["test"], "sample.pdf");
const pdf = { numPages: 3 };
let states: { value: unknown }[] = [];
let refs: { current: unknown }[] = [];
let stateCursor = 0;
let refCursor = 0;
let deleteFails = false;
let openFails = false;
let pdfFails = false;
let persistFails = false;
let persistWait: Promise<void> | null = null;
let exportFails = true;
const exported: Record<number, PenStroke[]>[] = [];
const exportedTexts: (TextNotesByPage | undefined)[] = [];
const savedInputs: LocalSaveInput[] = [];
const deletedItems: NoteDragItem[][] = [];
let openedTexts: TextNotesByPage | undefined;
const openedStrokes = { 2: [{ width: 5, points: [{ x: 0.2, y: 0.3 }] }] };

mock.module("react", { exports: {
  ...React,
  useState: <T,>(initial: T | (() => T)) => {
    const slotIndex = stateCursor++;
    const slot = states[slotIndex] ??= {
      value: slotIndex === 0 ? file : slotIndex === 1 ? pdf
        : typeof initial === "function" ? (initial as () => T)() : initial,
    };
    return [slot.value, (next: T | ((previous: T) => T)) => {
      slot.value = typeof next === "function" ? (next as (previous: T) => T)(slot.value as T) : next;
    }];
  },
  useRef: (initial: unknown) => refs[refCursor++] ??= { current: initial },
  useEffect: () => {},
} });
mock.module("@/features/pdf-editor/localNotes", { exports: {
  ...localNotes,
  saveLocalNote: async (input: LocalSaveInput) => {
    savedInputs.push(input);
    if (persistFails) throw new Error("容量不足");
    if (persistWait) await persistWait;
    return input.noteId ?? "created";
  },
  deleteSavedNote: async () => { if (deleteFails) throw new Error("削除失敗"); },
  deleteSavedItems: async (items: NoteDragItem[]) => {
    if (deleteFails) throw new Error("一括削除失敗");
    deletedItems.push(items);
  },
  loadLocalNote: async () => {
    if (openFails) throw new Error("読込失敗");
    return { file, id: "other", strokesByPage: openedStrokes, textsByPage: openedTexts, revision: 1 };
  },
} });
mock.module("pdfjs-dist/legacy/build/pdf.mjs", { exports: {
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: pdfFails ? Promise.reject(new Error("PDF解析失敗")) : Promise.resolve(pdf), destroy: async () => {} }),
} });
mock.module("@/features/pdf-editor/exportAnnotatedPdf", { exports: {
  exportAnnotatedPdf: async (_file: unknown, _pdf: unknown, strokes: Record<number, PenStroke[]>, texts?: TextNotesByPage) => {
    exported.push(strokes);
    exportedTexts.push(texts);
    // 出力に渡すデータだけを確認し、DOMでのダウンロードは実行しない。
    if (exportFails) throw new Error("テスト用の出力停止");
    return new Uint8Array([1, 2, 3]);
  },
} });
const { PdfWorkspace } = await import("@/features/pdf-editor/components/PdfWorkspace");
const { PdfPage } = await import("@/features/pdf-editor/components/PdfPage");
const { HistoryControls } = await import("@/features/pdf-editor/components/HistoryControls");
const { ZoomControl } = await import("@/features/pdf-editor/components/ZoomControl");
const { NotebookSidebar } = await import("@/features/pdf-editor/components/NotebookSidebar");
const { NotebookDrawer } = await import("@/features/pdf-editor/components/NotebookDrawer");
const { PenWidthControl } = await import("@/features/pdf-editor/components/PenWidthControl");
const { EditorIcon } = await import("@/features/pdf-editor/components/EditorIcon");
const { AppHeader } = await import("@/components/layout/AppHeader");

beforeEach(() => { states = []; refs = []; stateCursor = 0; refCursor = 0; deleteFails = false; openFails = false; pdfFails = false; persistFails = false; persistWait = null; exportFails = true; exported.length = 0; exportedTexts.length = 0; savedInputs.length = 0; deletedItems.length = 0; openedTexts = undefined; });

function render() {
  stateCursor = 0;
  refCursor = 0;
  return PdfWorkspace();
}

function find(node: React.ReactNode, predicate: (element: React.ReactElement) => boolean): React.ReactElement | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) continue;
    if (predicate(child)) return child;
    const result = find(child.props.children, predicate);
    if (result) return result;
  }
}

function props<T>(type: (props: T) => React.ReactNode): T {
  return find(render(), (element) => element.type === type)!.props as T;
}

function setup() {
  render();
  refs[0].current = true; // mountedRef（useEffectの代用）
  const calls: LocalSaveInput[] = [];
  const autosave = createLocalAutosave({
    file, noteId: "existing", strokesByPage: {},
    persist: async (input) => { calls.push(input); return "existing"; }, onChange: () => {},
  });
  refs[3].current = autosave;
  return { calls, autosave };
}

const red: PenStroke = { width: 2.5, color: "#ff0000", points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] };

function editorRow(name: string) {
  return find(render(), (element) => (element.props as { "data-editor-row"?: string })["data-editor-row"] === name)! as React.ReactElement<React.ComponentProps<"div">>;
}

function assertStableToolRows() {
  const row = editorRow("tools");
  assert.match(row.props.className!, /h-14/);
  assert.match(row.props.className!, /overflow-x-auto/);
  assert.match(row.props.className!, /\[&>\*\]:shrink-0/);
  assert.doesNotMatch(row.props.className!, /flex-wrap/);
  const children = React.Children.toArray(row.props.children) as React.ReactElement<React.ComponentProps<"div">>[];
  assert.equal(children.length, 3);
  assert.equal(children[0].props["aria-label"], "編集ツール");
  assert.equal(children[1].type, HistoryControls);
  assert.equal(children[2].type, ZoomControl);
  assert.equal(find(row, (element) => element.type === PenWidthControl), undefined);
  assert.match(editorRow("settings").props.className!, /h-14/);
  assert.match(editorRow("settings").props.className!, /overflow-x-auto/);
  assert.equal(find(editorRow("settings"), (element) => element.type === HistoryControls), undefined);
}

test("道具切替で編集操作の並びを変えず、テキスト・付箋も同じ高さの設定欄を使う", () => {
  const { calls } = setup();
  for (const label of ["ペン", "マーカー", "消しゴム", "テキスト", "付箋", "移動・閲覧"]) {
    (button(label)!.props as { onClick: () => void }).onClick();
    assertStableToolRows();
    if (label === "テキスト" || label === "付箋") {
      const children = React.Children.toArray(editorRow("settings").props.children) as React.ReactElement<React.ComponentProps<"div">>[];
      assert.equal(children.length, 2); // 操作ボタンの表示先とスマホ用の倍率。
      assert.equal(children[0].props["data-text-controls" as keyof React.ComponentProps<"div">], true);
      const container = {} as HTMLDivElement;
      (children[0].props.ref as (element: HTMLDivElement | null) => void)(container);
      assert.equal(props(PdfPage).textControlsContainer, container);
    }
    if (label === "消しゴム") {
      assert.equal(React.Children.toArray(editorRow("settings").props.children).length, 2); // サイズ操作とスマホ用の倍率。
      assert.equal(find(render(), (element) => element.type === "p"
        && String((element.props as { children?: unknown }).children).includes("書き込みの触れた部分を消します")), undefined);
      assert.equal(props(PdfPage).tool, "eraser");
    }
  }
  assert.equal(calls.length, 0);
  assert.equal(props(HistoryControls).canUndo, false);
});

test("スマホ設定は初期状態で閉じ、必要時に開ける。移動・閲覧や倍率変更では保存・履歴を増やさない", () => {
  const { calls } = setup();
  assert.equal(editorRow("settings").props["data-mobile-open" as keyof React.ComponentProps<"div">], false);
  const settings = button("道具の設定")!.props as React.ComponentProps<"button">;
  assert.equal(settings["aria-expanded"], false);
  settings.onClick!({} as React.MouseEvent<HTMLButtonElement>);
  assert.equal(editorRow("settings").props["data-mobile-open" as keyof React.ComponentProps<"div">], true);
  (button("移動・閲覧")!.props as { onClick: () => void }).onClick();
  assert.equal(props(PdfPage).tool, "hand");
  props(PdfPage).onZoomChange(1.5);
  assert.equal(props(PdfPage).zoom, 1.5);
  assert.equal(calls.length, 0);
  assert.equal(props(HistoryControls).canUndo, false);
  assert.equal(props(AppHeader).compact, true);
});

test("スマホの書き出しメニューにPDFダウンロードと保管案内をまとめ、PCの出力欄も残す", () => {
  setup();
  const header = find(render(), (element) => element.type === AppHeader)!;
  const menu = find(header, (element) => element.type === "details")!;
  const summary = find(menu, (element) => element.type === "summary")!.props as React.ComponentProps<"summary">;
  assert.equal(summary["aria-label"], "書き出しメニュー");
  assert.match((menu.props as React.ComponentProps<"details">).className!, /mobile-only/);
  assert.ok(find(menu, (element) => element.type === "button" && (element.props as { children?: string }).children === "PDFをダウンロード"));
  assert.ok(find(menu, (element) => "data-pdf-backup-notice" in (element.props as Record<string, unknown>)));
  const desktop = find(editorRow("actions"), (element) => element.type === "button" && (element.props as { children?: string }).children === "PDFをダウンロード")!;
  assert.match((desktop.props as React.ComponentProps<"button">).className!, /desktop-only/);
});

test("長いノート名・保存中・保存完了でも道具の行は移動させず、状態は名前横の同じ欄に表示する", async () => {
  setup();
  props(NotebookSidebar).onOpen({ id: "other", title: "授業ノート" } as SavedNoteSummary);
  for (let i = 0; i < 20 && refs[1].current; i++) await new Promise(setImmediate);
  assert.equal(refs[1].current, false);
  const longName = "長い授業ノート名".repeat(100);
  props(NotebookSidebar).onRenamed("other", longName);
  const title = find(render(), (element) => element.type === "p"
    && (element.props as { title?: string }).title === longName)!;
  assert.match((title.props as { className: string }).className, /truncate/);
  assert.equal(find(editorRow("tools"), (element) => (element.props as { title?: string }).title === longName), undefined);
  assertStableToolRows();
  const titleChildren = React.Children.toArray(editorRow("title").props.children) as React.ReactElement<Record<string, unknown>>[];
  assert.equal(titleChildren.length, 2);
  assert.equal(titleChildren[0].props.title, longName);
  assert.equal(titleChildren[1].props["data-editor-row"], "status");
  assert.match(String(titleChildren[1].props.className), /w-20 shrink-0 whitespace-nowrap/);
  let finish!: () => void;
  persistWait = new Promise<void>((resolve) => { finish = resolve; });
  props(PdfPage).onStrokeComplete(red);
  const saving = (refs[3].current as ReturnType<typeof createLocalAutosave>).flush();
  await Promise.resolve();
  try {
    assert.equal(editorRow("status").props.children, "保存中…");
    assertStableToolRows();
    assert.equal(find(editorRow("tools"), (element) => (element.props as { role?: string }).role === "status"), undefined);
  } finally { finish(); await saving; }
  assert.equal(editorRow("status").props.children, "");
  assertStableToolRows();
});

test("PC・スマホとも未編集・保存済みは空欄とし、保存中・保存失敗・再試行を維持する", async () => {
  const mobileStatus = () => find(render(), (element) => "data-editor-mobile-status" in (element.props as Record<string, unknown>))!
    .props as React.ComponentProps<"p">;
  const assertStatus = (expected: string) => {
    assert.equal(editorRow("status").props.children, expected);
    assert.equal(mobileStatus().children, expected);
    assert.match(mobileStatus().className!, /min-h-4/);
    assert.match(editorRow("status").props.className!, /w-20 shrink-0/);
  };
  setup();
  const fileInput = find(render(), (element) => element.type === "input"
    && (element.props as { id?: string }).id === "pdf-upload")!;
  (fileInput.props as React.ComponentProps<"input">).onChange!({ target: { files: [file], value: file.name } } as unknown as React.ChangeEvent<HTMLInputElement>);
  for (let i = 0; i < 20 && refs[1].current; i++) await new Promise(setImmediate);
  assert.equal(refs[1].current, false);
  assertStatus("");
  const autosave = refs[3].current as ReturnType<typeof createLocalAutosave>;
  persistFails = true;
  props(PdfPage).onStrokeComplete(red);
  assertStatus("保存中…");
  await autosave.flush();
  assertStatus("保存失敗");
  assert.match(editorRow("status").props.className!, /text-error/);
  assert.ok(button("保存を再試行"));
  assert.deepEqual(props(PdfPage).strokes, [red]);
  persistFails = false;
  (button("保存を再試行")!.props as { onClick: () => void }).onClick();
  await autosave.flush();
  assertStatus("");
  assert.equal(button("保存を再試行"), undefined);
});

test("前後のページは矢印だけを表示し、操作名・端の無効化とページ番号を維持する", () => {
  const { calls } = setup();
  function check(label: string, iconName: string, disabled: boolean) {
    const control = button(label)!.props as React.ComponentProps<"button">;
    assert.equal(control["aria-label"], label);
    assert.equal(control.title, label);
    assert.equal(control.disabled, disabled);
    assert.match(control.className!, /btn-square/);
    const children = React.Children.toArray(control.children) as React.ReactElement<{ name: string }>[];
    assert.equal(children.length, 1);
    assert.equal(children[0].type, EditorIcon);
    assert.equal(children[0].props.name, iconName);
    return control.onClick as () => void;
  }
  check("前のページ", "previous-page", true)();
  assert.equal(props(PdfPage).pageNumber, 1);
  check("次のページ", "next-page", false)();
  assert.equal(props(PdfPage).pageNumber, 2);
  check("前のページ", "previous-page", false);
  check("次のページ", "next-page", false)();
  assert.equal(props(PdfPage).pageNumber, 3);
  check("次のページ", "next-page", true)();
  assert.equal(props(PdfPage).pageNumber, 3);
  const counter = find(render(), (element) => element.type === "span"
    && (element.props as { "aria-live"?: string })["aria-live"] === "polite")!;
  assert.equal(React.Children.toArray((counter.props as { children: React.ReactNode }).children).join(""), "3 / 3");
  assert.equal(calls.length, 0);
});

test("スライダーとPDF上のズームを相互に反映し、保存や編集履歴には追加しない", () => {
  const { calls } = setup();
  props(ZoomControl).onChange(1.25);
  assert.equal(props(PdfPage).zoom, 1.25);
  props(PdfPage).onZoomChange(1.67);
  assert.equal(props(ZoomControl).value, 1.67);
  assert.equal(props(HistoryControls).canUndo, false);
  assert.equal(calls.length, 0);
  props(NotebookSidebar).onMutationChange(true);
  assert.equal(props(ZoomControl).disabled, true);
  assert.equal(props(PdfPage).disabled, true);
});

test("道具はアイコンだけを表示し、名前・選択状態・道具切替の接続を維持する", () => {
  const { calls } = setup();
  const tools = [["ペン", "pen"], ["マーカー", "marker"], ["消しゴム", "eraser"], ["テキスト", "text"], ["付箋", "sticky"]] as const;
  for (const [label, tool] of tools) {
    const control = button(label)!;
    const controlProps = control.props as React.ComponentProps<"button">;
    assert.equal(controlProps["aria-label"], label);
    assert.equal(controlProps.title, label);
    assert.equal(controlProps.disabled, false);
    const icon = find(controlProps.children, (element) => element.type === EditorIcon)!;
    assert.equal((icon.props as React.ComponentProps<typeof EditorIcon>).name, tool);
    (controlProps.onClick as () => void)();
    assert.equal(props(PdfPage).tool, tool);
    for (const [otherLabel, otherTool] of tools) {
      const other = button(otherLabel)!.props as React.ComponentProps<"button">;
      assert.equal(other["aria-pressed"], otherTool === tool);
      assert.equal(other.className?.includes("bg-base-300"), otherTool === tool);
    }
  }
  assert.equal(props(HistoryControls).canUndo, false);
  assert.equal(calls.length, 0);
});

test("処理中はアイコンの道具切替を無効にし、現在の道具を保持する", () => {
  setup();
  props(NotebookSidebar).onMutationChange(true);
  for (const label of ["ペン", "マーカー", "消しゴム", "テキスト", "付箋"]) {
    const control = button(label)!.props as React.ComponentProps<"button">;
    assert.equal(control.disabled, true);
    (control.onClick as () => void)();
    assert.equal(props(PdfPage).tool, "pen");
  }
});

test("マーカーとペンの色・太さを別々に保持し、設定変更だけでは保存や履歴を増やさない", () => {
  const { calls } = setup();
  function chooseColor(value: string) {
    const input = find(render(), (element) => element.type === "input"
      && (element.props as { id?: string }).id === "pen-color")!;
    (input.props as { onChange: (event: { target: { value: string } }) => void }).onChange({ target: { value } });
  }
  props(PenWidthControl).onChange(5);
  chooseColor("#112233");
  (button("マーカー")!.props as { onClick: () => void }).onClick();
  assert.equal(props(PdfPage).tool, "marker");
  assert.equal(props(PdfPage).penWidth, 16);
  assert.equal(props(PdfPage).penColor, "#facc15");
  assert.equal(props(PenWidthControl).tool, "marker");
  props(PenWidthControl).onChange(24);
  chooseColor("#00ff00");
  (button("ペン")!.props as { onClick: () => void }).onClick();
  assert.equal(props(PdfPage).penWidth, 5);
  assert.equal(props(PdfPage).penColor, "#112233");
  (button("マーカー")!.props as { onClick: () => void }).onClick();
  assert.equal(props(PdfPage).penWidth, 24);
  assert.equal(props(PdfPage).penColor, "#00ff00");
  assert.equal(props(HistoryControls).canUndo, false);
  assert.equal(calls.length, 0);
});

test("一覧は初期状態で閉じ、開閉してもPDFの倍率・内容・履歴と保存状態を変更しない", async () => {
  const { autosave, calls } = setup();
  props(PdfPage).onStrokeComplete(red);
  await autosave.flush();
  const before = props(PdfPage);
  const savedCount = calls.length;
  assert.equal(props(NotebookDrawer).open, false);
  const headerButton = find(props(AppHeader).children, (element) => element.type === "button")!;
  const trigger = headerButton.props as React.ComponentProps<"button">;
  assert.equal(trigger["aria-label"], "ノート一覧を開く");
  assert.equal(trigger["aria-controls"], "notebook-sidebar");
  assert.equal(trigger["aria-expanded"], false);
  assert.equal(trigger["aria-haspopup"], "dialog");
  (button("ノート一覧を開く")!.props as { onClick: () => void }).onClick();
  assert.equal(props(NotebookDrawer).open, true);
  assert.equal((button("ノート一覧を開く")!.props as React.ComponentProps<"button">)["aria-expanded"], true);
  assert.equal(props(PdfPage).strokes, before.strokes);
  assert.deepEqual(props(PdfPage).texts, before.texts);
  assert.equal(props(PdfPage).zoom, before.zoom);
  assert.equal(props(PdfPage).editVersion, before.editVersion);
  props(NotebookDrawer).onClose();
  assert.equal(props(NotebookDrawer).open, false);
  assert.equal(props(HistoryControls).canUndo, true);
  assert.equal(calls.length, savedCount);
  assert.equal(find(render(), (element) => element.type === "aside"), undefined);
});

test("編集中はファイル選択枠を隠し、保管案内を出力付近に1つだけ残す。削除後は選択枠へ戻る", async () => {
  setup();
  function uploadArea() {
    return find(render(), (element) => element.type === "div"
      && "data-pdf-upload" in (element.props as Record<string, unknown>))!;
  }
  assert.equal((uploadArea().props as { hidden: boolean }).hidden, true);
  const actionsContainer = find(render(), (element) => element.type === "div"
    && React.Children.toArray((element.props as { children?: React.ReactNode }).children).some((child) =>
      React.isValidElement<{ "data-editor-row"?: string }>(child) && child.props["data-editor-row"] === "actions"))!;
  const rows = React.Children.toArray((actionsContainer.props as { children: React.ReactNode }).children);
  assert.equal((rows.at(-1) as React.ReactElement<Record<string, unknown>>).props.className, "desktop-only");
  assert.ok(find(rows.at(-1), (element) => "data-pdf-backup-notice" in (element.props as Record<string, unknown>)));
  await props(NotebookSidebar).onDelete("existing");
  assert.equal((uploadArea().props as { hidden: boolean }).hidden, false);
  assert.ok(find(render(), (element) => element.type === "p"
    && "data-pdf-backup-notice" in (element.props as Record<string, unknown>)));
});

test("メニューからのPDF選択はキャンセル・失敗で内容を維持し、成功時だけ切り替えて一覧を閉じる", async () => {
  const { autosave } = setup();
  props(PdfPage).onStrokeComplete(red);
  await autosave.flush();
  const before = props(PdfPage);
  (button("ノート一覧を開く")!.props as { onClick: () => void }).onClick();
  const select = (files: File[]) => {
    const target = { files, value: "selected.pdf" };
    props(NotebookDrawer).onFileChange({ target } as unknown as React.ChangeEvent<HTMLInputElement>);
    assert.equal(target.value, ""); // 同じファイルを再選択できる。
  };
  select([]);
  assert.equal(props(PdfPage).strokes, before.strokes);
  assert.equal(props(NotebookDrawer).open, true);
  const nextFile = new File(["new pdf"], "次の授業.pdf", { type: "application/pdf" });
  const settle = async () => {
    for (let i = 0; i < 20 && refs[1].current; i++) await new Promise(setImmediate);
    assert.equal(refs[1].current, false);
  };
  pdfFails = true;
  select([nextFile]); await settle();
  assert.equal(props(PdfPage).strokes, before.strokes);
  assert.equal(props(HistoryControls).canUndo, true);
  assert.equal(props(NotebookDrawer).open, true);
  pdfFails = false;
  select([nextFile]); await settle();
  assert.deepEqual(props(PdfPage).strokes, []);
  assert.equal(props(HistoryControls).canUndo, false);
  assert.equal(props(NotebookDrawer).open, false);
  assert.equal(savedInputs.length, 0); // 開いただけでは新しいPDFを保存しない。
  assert.ok(find(render(), (element) => element.type === "p"
    && (element.props as { title?: string }).title === "次の授業"));
});

test("別ノートを読み込めた時だけ一覧を閉じ、失敗時は一覧とエラーを残す", async () => {
  setup();
  (button("ノート一覧を開く")!.props as { onClick: () => void }).onClick();
  openFails = true;
  props(NotebookSidebar).onOpen({ id: "other", title: "授業メモ" } as SavedNoteSummary);
  for (let i = 0; i < 20 && refs[1].current; i++) await new Promise(setImmediate);
  assert.equal(props(NotebookDrawer).open, true);
  assert.ok(find(props(NotebookDrawer).children, (element) => element.type === "p"
    && (element.props as { role?: string }).role === "alert"));
  openFails = false;
  await openOther();
  assert.equal(props(NotebookDrawer).open, false);
});

test("一覧を閉じても整理中の編集ロックを解除しない", () => {
  setup();
  (button("ノート一覧を開く")!.props as { onClick: () => void }).onClick();
  props(NotebookSidebar).onMutationChange(true);
  assert.equal(props(NotebookDrawer).busy, true);
  assert.equal(props(NotebookDrawer).pdfOpenDisabled, true);
  assert.equal(props(PdfPage).disabled, true);
  props(NotebookDrawer).onClose();
  assert.equal(props(PdfPage).disabled, true);
  props(NotebookSidebar).onMutationChange(false);
  assert.equal(props(PdfPage).disabled, false);
});

function button(label: string) {
  return find(render(), (element) => element.type === "button"
    && ((element.props as { children?: string }).children === label
      || (element.props as { "aria-label"?: string })["aria-label"] === label));
}

async function openOther() {
  props(NotebookSidebar).onOpen({ id: "other", title: "授業メモ" } as SavedNoteSummary);
  for (let i = 0; i < 20 && refs[1].current; i++) await new Promise(setImmediate);
  assert.equal(refs[1].current, false);
  assert.equal(props(NotebookSidebar).currentNoteId, "other");
}

test("画面のテキストと付箋の更新が保存・Undo・Redo・PDF出力へ接続される", async () => {
  setup();
  openedTexts = { 1: [{ id: "text", kind: "text", text: "日本語", x: 0.1, y: 0.1, width: 0.4, fontSize: 14 }] };
  await openOther();
  const autosave = refs[3].current as ReturnType<typeof createLocalAutosave>;
  assert.deepEqual(props(PdfPage).texts, openedTexts[1]);
  (button("付箋")!.props as { onClick: () => void }).onClick();
  assert.equal(props(PdfPage).tool, "sticky");
  const revised = [{ ...openedTexts[1][0], text: "変更" }, { ...openedTexts[1][0], id: "sticky", kind: "sticky" as const }];
  props(PdfPage).onTextsChange(revised);
  await autosave.flush();
  assert.deepEqual(savedInputs.at(-1)!.textsByPage, { 1: revised });
  props(HistoryControls).onUndo();
  await autosave.flush();
  assert.deepEqual(props(PdfPage).texts, openedTexts[1]);
  props(HistoryControls).onRedo();
  await autosave.flush();
  assert.deepEqual(props(PdfPage).texts, revised);
  (button("PDFをダウンロード")!.props as { onClick: () => void }).onClick();
  await new Promise(setImmediate);
  assert.deepEqual(exportedTexts.at(-1), { 1: revised });
  assert.deepEqual(exported.at(-1), openedStrokes);
});

test("PDFダウンロードは元ファイル名ではなく、変更後のノート名を使う", async () => {
  setup();
  await openOther();
  props(NotebookSidebar).onRenamed("other", "自分の復習メモ.pdf");
  exportFails = false;
  const downloads: string[] = [];
  const anchor = { href: "", download: "", click: () => { downloads.push(anchor.download); }, remove: () => {} };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    document: { createElement: () => anchor, body: { appendChild: () => {} } },
    setTimeout: (callback: () => void) => { callback(); return 0; },
  } });
  try {
    // a要素の入口だけを置き換え、OSへの実ファイル出力は行わない。
    (button("PDFをダウンロード")!.props as { onClick: () => void }).onClick();
    await new Promise(setImmediate);
    assert.deepEqual(downloads, ["自分の復習メモ.pdf"]);
    assert.equal(file.name, "sample.pdf");
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("通常の保存ボタンは表示せず、自動保存失敗時だけ再試行できる", async () => {
  setup();
  await openOther();
  assert.equal(button("今すぐ保存"), undefined);
  assert.equal(button("保存を再試行"), undefined);
  persistFails = true;
  props(PdfPage).onStrokeComplete(red);
  const autosave = refs[3].current as ReturnType<typeof createLocalAutosave>;
  assert.equal(await autosave.flush(), false);
  const retry = button("保存を再試行")!;
  assert.ok(retry);
  assert.equal((retry.props as { disabled: boolean }).disabled, false);
  assert.deepEqual(props(PdfPage).strokes, [red]);
  persistFails = false;
  (retry.props as { onClick: () => void }).onClick();
  assert.equal(await autosave.flush(), true);
  assert.equal(button("保存を再試行"), undefined);
  assert.equal(button("今すぐ保存"), undefined);
  assert.deepEqual(props(PdfPage).strokes, [red]);
});

test("画面の描画・消去・Undo・Redoが同じ履歴と自動保存へ接続される", async () => {
  const { autosave, calls } = setup();
  const notice = find(render(), (element) => element.type === "p"
    && String((element.props as { children?: unknown }).children).includes("編集履歴は直近"));
  assert.equal(notice, undefined);
  assert.equal(props(HistoryControls).canUndo, false);
  props(PdfPage).onStrokeComplete(red);
  await autosave.flush();
  assert.equal(props(HistoryControls).canUndo, true);
  assert.equal(props(HistoryControls).canRedo, false);
  props(PdfPage).onStrokesChange([]);
  await autosave.flush();
  const version = props(PdfPage).editVersion;
  props(HistoryControls).onUndo();
  await autosave.flush();
  assert.deepEqual(props(PdfPage).strokes, [red]);
  assert.ok(props(PdfPage).editVersion > version);
  props(HistoryControls).onUndo();
  await autosave.flush();
  assert.deepEqual(props(PdfPage).strokes, []);
  assert.equal(props(HistoryControls).canUndo, false);
  props(HistoryControls).onRedo();
  await autosave.flush();
  assert.deepEqual(props(PdfPage).strokes, [red]);
  props(HistoryControls).onRedo();
  await autosave.flush();
  assert.deepEqual(props(PdfPage).strokes, []);
  assert.deepEqual(calls.at(-1)!.strokesByPage, { 1: [] });
});

test("別ページでのUndoは対象ページを表示し、新規描画でRedoを無効化する", () => {
  setup();
  props(PdfPage).onStrokeComplete(red);
  const next = button("次のページ")!;
  (next.props as { onClick: () => void }).onClick();
  assert.equal(props(PdfPage).pageNumber, 2);
  props(PdfPage).onStrokeComplete(red);
  const previous = button("前のページ")!;
  (previous.props as { onClick: () => void }).onClick();
  assert.equal(props(PdfPage).pageNumber, 1);
  props(HistoryControls).onUndo();
  assert.equal(props(PdfPage).pageNumber, 2);
  assert.deepEqual(props(PdfPage).strokes, []);
  assert.equal(props(HistoryControls).canRedo, true);
  props(PdfPage).onStrokeComplete({ ...red, color: "#0000ff" });
  assert.equal(props(HistoryControls).canRedo, false);
});

test("整理中のUndoを拒否し、整理後のPDF出力には取り消し後の現在値を渡す", async () => {
  setup();
  props(PdfPage).onStrokeComplete(red);
  const undo = props(HistoryControls).onUndo;
  props(NotebookSidebar).onMutationChange(true);
  assert.equal(props(HistoryControls).disabled, true);
  undo();
  assert.deepEqual(props(PdfPage).strokes, [red]);
  props(NotebookSidebar).onMutationChange(false);
  props(HistoryControls).onUndo();
  const download = find(render(), (element) => element.type === "button" && (element.props as { children?: string }).children === "PDFをダウンロード")!;
  (download.props as { onClick: () => void }).onClick();
  await new Promise(setImmediate);
  assert.deepEqual(exported, [{}]);
});

test("ノート削除に失敗した場合は履歴を残し、成功後に内容と履歴を初期化する", async () => {
  setup();
  props(PdfPage).onStrokeComplete(red);
  deleteFails = true;
  await assert.rejects(props(NotebookSidebar).onDelete("existing"), /削除失敗/);
  assert.equal(props(HistoryControls).canUndo, true);
  assert.deepEqual(props(PdfPage).strokes, [red]);
  deleteFails = false;
  await props(NotebookSidebar).onDelete("existing");
  assert.equal(find(render(), (element) => element.type === PdfPage), undefined);
  assert.equal(find(render(), (element) => element.type === HistoryControls), undefined);
  assert.deepEqual((refs[4].current as { past: unknown[]; future: unknown[] }).past, []);
});

test("一括削除は開いているノートの保存を待ち、全件成功後だけ編集画面と履歴を消す", async () => {
  const { calls } = setup();
  props(PdfPage).onStrokeComplete(red);
  const items: NoteDragItem[] = [{ kind: "folder", id: "folder" }, { kind: "note", id: "existing" }];
  deleteFails = true;
  await assert.rejects(props(NotebookSidebar).onDeleteItems(items), /一括削除失敗/);
  assert.equal(props(HistoryControls).canUndo, true);
  assert.deepEqual(props(PdfPage).strokes, [red]);
  assert.deepEqual(deletedItems, []);
  assert.equal(calls.length, 1);
  deleteFails = false;
  await props(NotebookSidebar).onDeleteItems(items);
  assert.deepEqual(deletedItems, [items]);
  assert.equal(find(render(), (element) => element.type === PdfPage), undefined);
  assert.deepEqual((refs[4].current as { past: unknown[] }).past, []);
});

test("開いていないノート・フォルダの一括削除で編集中の内容と履歴をリセットしない", async () => {
  setup();
  props(PdfPage).onStrokeComplete(red);
  const items: NoteDragItem[] = [{ kind: "note", id: "other" }, { kind: "folder", id: "folder" }];
  await props(NotebookSidebar).onDeleteItems(items);
  assert.deepEqual(props(PdfPage).strokes, [red]);
  assert.equal(props(HistoryControls).canUndo, true);
  assert.deepEqual(deletedItems, [items]);
});

test("保存中のノートを一括削除するとき、保存完了前に削除せず編集中の追記も止める", async () => {
  setup();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  refs[3].current = createLocalAutosave({ file, noteId: "existing", strokesByPage: {},
    persist: async () => { await wait; return "existing"; }, onChange: () => {} });
  props(PdfPage).onStrokeComplete(red);
  props(NotebookSidebar).onMutationChange(true);
  const deletion = props(NotebookSidebar).onDeleteItems([{ kind: "note", id: "existing" }]);
  await new Promise(setImmediate);
  assert.deepEqual(deletedItems, []);
  props(PdfPage).onStrokeComplete({ ...red, width: 9 });
  assert.deepEqual(props(PdfPage).strokes, [red]);
  release();
  await deletion;
  assert.equal(deletedItems.length, 1);
  assert.equal(find(render(), (element) => element.type === PdfPage), undefined);
});

test("読み込み失敗時は履歴を保持し、別ノートを開けた時だけリセットする", async () => {
  setup();
  props(PdfPage).onStrokeComplete(red);
  const summary = { id: "other", title: "別ノート" } as SavedNoteSummary;
  const waitOpen = async () => {
    for (let i = 0; i < 20 && refs[1].current; i++) await new Promise(setImmediate);
    assert.equal(refs[1].current, false);
  };
  openFails = true;
  props(NotebookSidebar).onOpen(summary);
  await waitOpen();
  assert.equal(props(HistoryControls).canUndo, true);
  assert.deepEqual(props(PdfPage).strokes, [red]);
  openFails = false;
  props(NotebookSidebar).onOpen(summary);
  await waitOpen();
  assert.equal(props(NotebookSidebar).currentNoteId, "other");
  assert.equal(props(HistoryControls).canUndo, false);
  assert.equal(props(HistoryControls).canRedo, false);
  assert.equal(props(PdfPage).pageNumber, 1);
});
