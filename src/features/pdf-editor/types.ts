export type PenPoint = {
  x: number;
  y: number;
};

export type PenStroke = {
  points: PenPoint[];
  width: number;
  // 色がない旧ノートは従来の黒として表示する。
  color?: string;
  // 未指定の旧ノートは通常のペン。マーカーも同じ線として消去・履歴管理する。
  kind?: "pen" | "marker";
};

export type PenTool = "pen" | "marker" | "eraser";
export type EditorTool = PenTool | "text" | "sticky" | "hand";
export type TextNote = {
  id: string;
  kind: "text" | "sticky";
  text: string;
  x: number;
  y: number;
  width: number;
  // 新しいテキスト・付箋は文章と文字サイズから幅・高さを計算する。旧データはそのまま表示する。
  autoSize?: boolean;
  // 未指定の旧ボックスは文章の高さに合わせる。指定値も文章よりは小さくしない。
  height?: number;
  fontSize: number;
  color?: string;
  // 付箋のみ。未指定なら従来の薄黄色。
  backgroundColor?: string;
};
export type TextNotesByPage = Record<number, TextNote[]>;

export type SavedNoteSummary = {
  id: string;
  fileName: string;
  updatedAt: string;
  title: string;
  folderId: string | null;
};

export type NoteFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

export type NoteLibrary = {
  notes: SavedNoteSummary[];
  folders: NoteFolder[];
  foldersEnabled: boolean;
};

export type LoadedNote = {
  id: string;
  file: File;
  strokesByPage: Record<number, PenStroke[]>;
  textsByPage?: TextNotesByPage;
  // ローカル保存の更新番号。番号のない旧データは0として読み込む。
  revision?: number;
};
