import { readRequest, withLocalTransaction } from "./localDatabase";
import type { DriveBinding } from "./driveOutbox";
import { activeDriveSources } from "./driveVersionData";
import type { LibraryEntity } from "./driveLibraryData";

export type NoteDriveStatus = "saved" | "pending" | "warning";
export const NOTE_DRIVE_LABELS: Record<NoteDriveStatus, string> = {
  saved: "Driveから取得が必要", pending: "Driveへ未送信の変更あり", warning: "Drive保存に要確認の項目あり",
};

// PDF・本文を読み込まず、保存番号と階層の小さいメタデータから表示状態を作る。
export async function readNoteDriveStatuses(): Promise<Record<string, NoteDriveStatus>> {
  return withLocalTransaction(["driveBindings", "driveEntities", "driveSettings", "notes", "pdfs"], "readonly", async (tx) => {
    const [bindings, entities, pending, noteKeys, pdfKeys] = await Promise.all([
      readRequest<DriveBinding[]>(tx.objectStore("driveBindings").getAll()),
      readRequest<LibraryEntity[]>(tx.objectStore("driveEntities").getAll()),
      readRequest<{ value: boolean } | undefined>(tx.objectStore("driveSettings").get("tree-pending")),
      readRequest(tx.objectStore("notes").getAllKeys()),
      readRequest(tx.objectStore("pdfs").getAllKeys()),
    ]);
    const pdfIds = new Set(pdfKeys);
    const localIds = new Set(noteKeys.filter((id): id is string => typeof id === "string" && pdfIds.has(id)));
    return noteDriveStatuses(bindings, entities, !!pending?.value, localIds);
  });
}

export function noteDriveStatuses(bindings: DriveBinding[], entities: LibraryEntity[], treePending: boolean, localIds: Set<string> = new Set()): Record<string, NoteDriveStatus> {
  const statuses: Record<string, NoteDriveStatus> = {};
  const rows = new Map(entities.map((row) => [row.id, row]));
  for (const row of entities) {
    if (row.entry.kind !== "note" || row.entry.deleted) continue;
    if (row.cacheWarning || activeDriveSources(row).length > 1 || (row.adoptions?.length ?? 0) > 1) { statuses[row.entry.id] = "warning"; continue; }
    // 階層送信中は保守的に待機表示。大きくなる変更履歴全件をUI用に走査しない。
    if (treePending) statuses[row.entry.id] = "pending";
    else if (row.sources.length) statuses[row.entry.id] = "saved";
  }
  for (const binding of bindings) {
    if (rows.get(`note:${binding.id}`)?.entry.deleted) continue;
    if (binding.error) statuses[binding.id] = "warning";
    else if (statuses[binding.id] !== "warning") {
      if (binding.generation > binding.uploadedGeneration) statuses[binding.id] = "pending";
      else if (!statuses[binding.id] && binding.ids && binding.uploadedHash && binding.uploadedGeneration > 0) statuses[binding.id] = "saved";
    }
  }
  // 雲は保存の成功表示ではなく、この端末への取得が必要なノートの目印。
  // ローカルにもある場合は、送信待ち・警告の雲も付けない。失敗の案内は既存パネルに残る。
  for (const id of localIds) delete statuses[id];
  return statuses;
}
