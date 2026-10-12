import { getSupabaseClient } from "@/lib/supabase/client";

import { getNoteOwnerId, listSavedNotes } from "./loadNotes";
import type { NoteLibrary } from "./types";

export const FOLDER_SETUP_MESSAGE = "フォルダ機能のSQLをSupabaseで実行してください。";

function isMissingFolderTable(error: { code?: string } | null) {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

function checkedName(value: string, maxLength: number): string {
  const name = value.trim();
  if (!name || name.length > maxLength) {
    throw new Error(`名前は1〜${maxLength}文字で入力してください。`);
  }
  return name;
}

export async function loadNoteLibrary(): Promise<NoteLibrary> {
  const ownerId = await getNoteOwnerId();
  if (!ownerId) return { notes: [], folders: [], foldersEnabled: true };

  const { data, error } = await getSupabaseClient()
    .from("note_folders")
    .select("id, name, parent_id")
    .eq("owner_id", ownerId)
    .order("name", { ascending: true });

  if (isMissingFolderTable(error)) {
    // 新しいSQLを実行する前も、従来のノートの読み込みは維持する。
    return { notes: await listSavedNotes(), folders: [], foldersEnabled: false };
  }
  if (error) throw new Error("フォルダを読み込めませんでした。", { cause: error });

  return {
    notes: await listSavedNotes(true),
    folders: (data ?? []).map((folder) => ({
      id: folder.id, name: folder.name, parentId: folder.parent_id,
    })),
    foldersEnabled: true,
  };
}

export async function createNoteFolder(name: string, parentId: string | null): Promise<string> {
  const trimmedName = checkedName(name, 100);
  const supabase = getSupabaseClient();
  let ownerId = await getNoteOwnerId();
  if (!ownerId) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      throw new Error("保存用の接続を開始できませんでした。", { cause: error });
    }
    ownerId = data.user.id;
  }
  const id = crypto.randomUUID();
  const { error } = await supabase.from("note_folders").insert({
    id, owner_id: ownerId, name: trimmedName, parent_id: parentId,
  });

  if (isMissingFolderTable(error)) throw new Error(FOLDER_SETUP_MESSAGE, { cause: error });
  if (error?.code === "23505") throw new Error("同じ場所に同じ名前のフォルダがあります。");
  if (error) throw new Error("フォルダを作成できませんでした。", { cause: error });
  return id;
}

export async function organizeNote(noteId: string, title: string, folderId: string | null): Promise<void> {
  const trimmedTitle = checkedName(title, 120);
  const ownerId = await getNoteOwnerId();
  if (!ownerId) throw new Error("このブラウザには保存したノートの識別情報がありません。");

  const { error } = await getSupabaseClient()
    .from("notes")
    .update({ title: trimmedTitle, folder_id: folderId, updated_at: new Date().toISOString() })
    .eq("id", noteId)
    .eq("owner_id", ownerId)
    .select("id")
    .single();

  if (error) throw new Error("ノートの名前・保存先を変更できませんでした。", { cause: error });
}

export async function moveSavedNote(noteId: string, folderId: string | null): Promise<void> {
  const ownerId = await getNoteOwnerId();
  if (!ownerId) throw new Error("このブラウザには保存したノートの識別情報がありません。");
  const { error } = await getSupabaseClient()
    .from("notes")
    // 移動では名前や線を送らず、未保存の書き込みもそのまま残す。
    .update({ folder_id: folderId, updated_at: new Date().toISOString() })
    .eq("id", noteId)
    .eq("owner_id", ownerId)
    .select("id")
    .single();
  if (error) throw new Error("ノートを移動できませんでした。", { cause: error });
}

export async function moveNoteFolder(folderId: string, parentId: string | null): Promise<void> {
  const ownerId = await getNoteOwnerId();
  if (!ownerId) throw new Error("このブラウザには保存したフォルダの識別情報がありません。");
  const { data, error } = await getSupabaseClient().rpc("move_note_folder", {
    moving_folder_id: folderId,
    destination_parent_id: parentId,
  });
  if (error?.code === "PGRST202" || error?.code === "42883") {
    throw new Error("フォルダ移動用のSQLをSupabaseで実行してください。", { cause: error });
  }
  if (error?.code === "23514") throw new Error("自分自身や子フォルダの中へは移動できません。");
  if (error?.code === "23505") throw new Error("移動先に同じ名前のフォルダがあります。");
  if (error || data !== folderId) throw new Error("フォルダを移動できませんでした。", { cause: error });
}
