import { getSupabaseClient } from "@/lib/supabase/client";

import type { PenStroke } from "./types";

const PDF_BUCKET = "overlay-pdfs";

type SaveNoteInput = {
  file: File;
  strokesByPage: Record<number, PenStroke[]>;
  noteId: string | null;
};

export async function saveNote({
  file,
  strokesByPage,
  noteId,
}: SaveNoteInput): Promise<string> {
  const supabase = getSupabaseClient();
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError) {
    throw new Error("保存用の接続を確認できませんでした。", {
      cause: sessionError,
    });
  }

  let user = sessionData.session?.user;

  // 開いているノートを、別の匿名ユーザーとして更新しようとしない。
  // PDFの書き出しには識別情報が不要なので、未保存の内容を手元に残せる。
  if (!user && noteId) {
    throw new Error(
      "保存したノートの識別情報が見つかりません。未保存の内容はPDFをダウンロードして残してください。",
    );
  }

  // ログイン操作を要求せず、保存したブラウザのデータだけを扱うための識別情報を作る。
  if (!user) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) {
      throw new Error("保存用の接続を開始できませんでした。", { cause: error });
    }
    user = data.user;
  }

  if (noteId) {
    const { error } = await supabase
      .from("notes")
      .update({
        strokes_by_page: strokesByPage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", noteId)
      .eq("owner_id", user.id)
      .select("id")
      .single();

    if (error) {
      throw new Error("書き込み情報を保存できませんでした。", { cause: error });
    }
    return noteId;
  }

  const id = crypto.randomUUID();
  const pdfPath = `${user.id}/${id}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(pdfPath, file, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    throw new Error("PDFを保存できませんでした。", { cause: uploadError });
  }

  const { error: insertError, status: insertStatus } = await supabase
    .from("notes")
    .insert({
      id,
      owner_id: user.id,
      file_name: file.name,
      pdf_path: pdfPath,
      strokes_by_page: strokesByPage,
    });

  if (insertError) {
    // 拒否が確定した場合だけ後片付けする。通信切断やサーバーエラーでは、
    // ノートが保存されて応答だけが失われた可能性があるので、PDFを削除しない。
    if (insertStatus >= 400 && insertStatus < 500 && insertStatus !== 408) {
      const { error: cleanupError } = await supabase.storage
        .from(PDF_BUCKET)
        .remove([pdfPath]);

      if (cleanupError) {
        console.error("保存に失敗したPDFを削除できませんでした。", cleanupError);
      }
    }
    throw new Error("書き込み情報を保存できませんでした。", { cause: insertError });
  }

  return id;
}
