export type PenPoint = {
  x: number;
  y: number;
};

export type PenStroke = {
  points: PenPoint[];
  width: number;
};

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
};
