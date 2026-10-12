import { getSupabaseClient } from "@/lib/supabase/client";

import type { LoadedNote, PenStroke, SavedNoteSummary } from "./types";

// JSONはTypeScriptの型だけでは保証できないため、描画する前に確認する。
function readStrokes(value: unknown): Record<number, PenStroke[]> {
  const invalid = () => new Error("保存された書き込み情報を読み込めませんでした。");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid();
  }

  const result: Record<number, PenStroke[]> = {};
  for (const [page, strokes] of Object.entries(value)) {
    if (
      !/^[1-9]\d*$/.test(page) ||
      !Number.isSafeInteger(Number(page)) ||
      !Array.isArray(strokes)
    ) {
      throw invalid();
    }
    result[Number(page)] = strokes.map((stroke: unknown) => {
      if (
        !stroke || typeof stroke !== "object" ||
        !("width" in stroke) || !("points" in stroke)
      ) {
        throw invalid();
      }
      const { width, points } = stroke;
      if (
        typeof width !== "number" || !Number.isFinite(width) || width <= 0 ||
        !Array.isArray(points) || points.length === 0
      ) {
        throw invalid();
      }
      return {
        width,
        points: points.map((point: unknown) => {
          if (
            !point || typeof point !== "object" ||
            !("x" in point) || !("y" in point)
          ) {
            throw invalid();
          }
          const { x, y } = point;
          if (
            typeof x !== "number" || typeof y !== "number" ||
            !Number.isFinite(x) || !Number.isFinite(y) ||
            x < 0 || x > 1 || y < 0 || y > 1
          ) {
            throw invalid();
          }
          return { x, y };
        }),
      };
    });
  }
  return result;
}

export async function getNoteOwnerId(): Promise<string | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) {
    throw new Error("保存用の接続を確認できませんでした。", { cause: error });
  }
  // 一覧を見るだけでは新しい匿名ユーザーを作らない。
  return data.session?.user.id ?? null;
}

export async function listSavedNotes(includeFolders = false): Promise<SavedNoteSummary[]> {
  const ownerId = await getNoteOwnerId();
  if (!ownerId) return [];

  const { data, error } = await getSupabaseClient()
    .from("notes")
    .select(includeFolders
      ? "id, file_name, updated_at, title, folder_id"
      : "id, file_name, updated_at")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .overrideTypes<{
      id: string;
      file_name: string;
      updated_at: string;
      title?: string | null;
      folder_id?: string | null;
    }[], { merge: false }>();

  if (error) {
    throw new Error("ノート一覧を読み込めませんでした。更新して再試行してください。", { cause: error });
  }

  return (data ?? []).map((note) => ({
    id: note.id,
    fileName: note.file_name,
    updatedAt: note.updated_at,
    title: note.title ?? (note.file_name.replace(/\.pdf$/i, "") || note.file_name),
    folderId: note.folder_id ?? null,
  }));
}

export async function loadSavedNote(noteId: string): Promise<LoadedNote> {
  const ownerId = await getNoteOwnerId();
  if (!ownerId) {
    throw new Error("このブラウザには保存したノートの識別情報がありません。");
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("notes")
    .select("id, file_name, pdf_path, strokes_by_page")
    .eq("id", noteId)
    .eq("owner_id", ownerId)
    .single();

  if (error || !data) {
    throw new Error("ノートを読み込めませんでした。", { cause: error });
  }
  if (
    data.id !== noteId || data.pdf_path !== `${ownerId}/${noteId}.pdf` ||
    typeof data.file_name !== "string"
  ) {
    throw new Error("保存されたPDFの情報を確認できませんでした。");
  }
  const strokesByPage = readStrokes(data.strokes_by_page);
  // 非公開バケットから、現在の識別情報に許可された元PDFを取得する。
  const { data: pdf, error: downloadError } = await supabase.storage
    .from("overlay-pdfs")
    .download(data.pdf_path);

  if (downloadError || !pdf) {
    throw new Error("保存されたPDFを読み込めませんでした。", { cause: downloadError });
  }

  return {
    id: data.id,
    file: new File([pdf], data.file_name, { type: "application/pdf" }),
    strokesByPage,
  };
}
