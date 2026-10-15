import { getSupabaseClient } from "@/lib/supabase/client";

import type { LoadedNote, SavedNoteSummary } from "./types";
import { readStrokes } from "./strokeData";

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
