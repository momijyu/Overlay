import type { NoteBackup } from "./noteBackupData";
import { singleDriveNote, type DriveNoteSummary, type DriveOverwriteTarget } from "./googleDriveNoteData";

// 一覧と取得口だけ保持し、全ノートのPDF・編集本文を一括で抱えない。
export type DriveSaveSource = { id: string; title: string; load: () => Promise<NoteBackup> };
export type DriveBatchEntry = {
  source: DriveSaveSource; target?: DriveOverwriteTarget | null;
  status: "unchecked" | "ready" | "saving" | "saved" | "failed";
  error?: string;
};
export type DriveBatchAccess = {
  findSaveTargetByTitle(account: string, root: string, title: string): Promise<DriveOverwriteTarget | null>;
  saveConfirmedNote(account: string, root: string, backup: NoteBackup, target: DriveOverwriteTarget | null): Promise<DriveNoteSummary>;
};

export function createDriveBatch(sources: DriveSaveSource[]): DriveBatchEntry[] {
  if (!sources.length || sources.length > 200 || new Set(sources.map((source) => source.id)).size !== sources.length) {
    throw new Error("保存するノートは1〜200件で選択してください。");
  }
  const titles = new Set<string>();
  for (const source of sources) {
    if (!source.id || !source.title.trim() || [...source.title].length > 120 || /\p{Cc}/u.test(source.title)) throw new Error("保存するノート名が不正です。");
    if (titles.has(source.title)) throw new Error(`選択したノートに同名の「${source.title}」があります。名前を変更してから保存してください。`);
    titles.add(source.title);
  }
  return sources.map((source) => ({ source: { ...source }, status: "unchecked" }));
}

export async function prepareDriveBatch(entries: DriveBatchEntry[], access: DriveBatchAccess, account: string, root: string,
  active: () => boolean, update: (entries: DriveBatchEntry[]) => void): Promise<DriveBatchEntry[]> {
  const result = entries.map((entry) => entry.status === "saved" ? entry : { ...entry, target: undefined, status: "unchecked" as const, error: undefined });
  for (let index = 0; index < result.length; index++) {
    if (!active()) return result;
    if (result[index].status === "saved") continue;
    const entry = result[index];
    try {
      const target = await access.findSaveTargetByTitle(account, root, entry.source.title);
      if (!active()) return result;
      result[index] = { ...entry, target, status: "ready" };
    } catch (error) {
      if (!active()) return result;
      result[index] = { ...entry, status: "failed", error: error instanceof Error ? error.message : "保存先を確認できませんでした。" };
      update([...result]);
      return result; // 失効や曖昧な対象で残りの検索を続けない。
    }
    update([...result]);
  }
  return result;
}

export async function saveDriveBatch(entries: DriveBatchEntry[], access: DriveBatchAccess, account: string, root: string,
  active: () => boolean, update: (entries: DriveBatchEntry[]) => void, saved: (note: DriveNoteSummary) => void): Promise<void> {
  if (!entries.length || entries.some((entry) => entry.status !== "saved" && (entry.status !== "ready" || entry.target === undefined))) {
    throw new Error("保存先を確認し直してください。");
  }
  const result = [...entries];
  for (let index = 0; index < result.length; index++) {
    if (!active()) return;
    const entry = result[index];
    if (entry.status === "saved") continue;
    result[index] = { ...entry, status: "saving" }; update([...result]);
    try {
      // 1件の送信が終わってから次を読む。確認した名前と異なれば送信しない。
      const backup = await entry.source.load();
      if (!active()) return;
      if (singleDriveNote(backup).title !== entry.source.title) throw new Error("確認後にノート名が変わりました。一覧から選び直してください。");
      const note = await access.saveConfirmedNote(account, root, backup, entry.target!);
      if (!active()) return;
      result[index] = { ...entry, status: "saved", error: undefined };
      update([...result]); saved(note);
    } catch (error) {
      if (!active()) return;
      result[index] = { ...entry, status: "failed", error: error instanceof Error ? error.message : "保存結果を確認できませんでした。" };
      update([...result]);
      return; // 結果不明もあるため自動で再送・続行しない。成功分を戻そうとする削除もしない。
    }
  }
}
