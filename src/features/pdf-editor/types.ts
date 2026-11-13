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
  kind?: "pen" | "marker" | "fill";
};

export type PenTool = "pen" | "marker" | "eraser";
export type EditorTool = PenTool | "text" | "sticky" | "hand" | "lasso" | "shape" | "fill" | "image";

export type NoteImage = {
  id: string; assetId: string;
  x: number; y: number; width: number; height: number;
  rotation: 0 | 90 | 180 | 270;
  crop: { x: number; y: number; width: number; height: number };
};
export type ImageAsset = { blob: Blob; width: number; height: number };
// 配置と元画像を分離する。Blobは不変で、移動・履歴で画素データを複製しない。
export type NoteImages = { byPage: Record<number, NoteImage[]>; assets: Record<string, ImageAsset> };
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
export type HeadingsByPage = Record<number, string>;
export type StickyPageLink = { pageId: number; pageNumber: number; textId: string; label: string; sourceId?: string };

// idは書き込みのキー。配列の位置（表示順）とは独立させる。
export type BlankPageTemplate = "plain" | "ruled" | "grid";
export type NotePage =
  | { id: number; kind: "pdf"; pageNumber: number }
  | { id: number; kind: "blank"; width: number; height: number; template?: BlankPageTemplate };

export type SavedNoteSummary = {
  id: string;
  fileName: string;
  updatedAt: string;
  title: string;
  folderId: string | null;
  // 付箋一覧用の派生情報。本文・PDF・座標は含めない。
  stickyNotes?: StickyPageLink[];
  stickyNotesPending?: boolean;
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
  pages?: NotePage[];
  headingsByPage?: HeadingsByPage;
  images?: NoteImages;
  // ローカル保存の更新番号。番号のない旧データは0として読み込む。
  revision?: number;
};
