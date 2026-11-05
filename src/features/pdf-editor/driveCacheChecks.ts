import { libraryScope } from "./driveLibraryLocal";
import type { LibraryEntity, LibraryScope } from "./driveLibraryData";
import type { DriveBinding } from "./driveOutbox";
import { readRequest, withLocalTransaction } from "./localDatabase";
import { driveNoteSummary, driveObject, DRIVE_NOTE_FIELDS } from "./googleDriveNoteData";
import type { DriveNoteAccess } from "./googleDriveNotes";
import { notifyDriveQueue } from "./driveQueueEvents";

const RECHECK_MS = 30000;
type Checks = { pending: Set<string>; checked: Map<string, { signature: string; at: number }> };
const checks = new WeakMap<IDBFactory, Checks>();
function state() {
  let value = checks.get(indexedDB);
  if (!value) { value = { pending: new Set(), checked: new Map() }; checks.set(indexedDB, value); }
  return value;
}
const signature = (row: LibraryEntity) => JSON.stringify([row.head, row.cachedSource, row.cachedVersion]);
const listeners = new Set<(id: string, message: string) => void>();
export function subscribeDriveCacheIssue(listener: (id: string, message: string) => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function queueDriveCacheCheck(id: string, row: LibraryEntity) {
  const current = state(); const previous = current.checked.get(id);
  if (previous?.signature === signature(row) && Date.now() - previous.at < RECHECK_MS) return;
  if (!current.pending.has(id)) { current.pending.add(id); notifyDriveQueue(); }
}
export function hasDriveCacheChecks() { return typeof indexedDB !== "undefined" && state().pending.size > 0; }

// 表示後の更新確認だけを行う。PDF取得・本文置換・送信先の変更はしない。
export async function checkQueuedDriveCaches(access: DriveNoteAccess, scope: LibraryScope, active: () => boolean) {
  const current = state();
  for (const id of [...current.pending]) {
    if (!active()) return;
    current.pending.delete(id);
    const initial = await withLocalTransaction(["driveEntities", "driveBindings"], "readonly", async (tx) => ({
      row: await readRequest<LibraryEntity | undefined>(tx.objectStore("driveEntities").get(`note:${id}`)),
      binding: await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(id)),
    }));
    const { row, binding } = initial;
    const source = row?.sources.find((source) => source.noteId === row.cachedSource);
    if (!row || row.entry.deleted || !source || !row.cachedVersion || row.cacheWarning
      || binding && binding.generation > binding.uploadedGeneration) continue;
    try {
      const metadata = driveObject(await access.json(`files/${source.noteId}`, { fields: DRIVE_NOTE_FIELDS }));
      if (!active()) return;
      const summary = driveNoteSummary(metadata, scope.rootId);
      if (summary.id !== source.noteId || summary.noteKey !== source.noteKey || summary.containerId !== source.containerId
        || summary.deviceId !== source.deviceId) throw new Error("Driveノートの取得先を確認できませんでした。");
      if (String(metadata.version) !== row.cachedVersion) {
        const message = "Drive上でこのノートが更新されています。表示中の内容は保持しています。ノート一覧から開き直して確認してください。";
        const changed = await withLocalTransaction(["driveEntities", "driveBindings", "driveSettings"], "readwrite", async (tx) => {
          const liveScope = await libraryScope(tx);
          const store = tx.objectStore("driveEntities");
          const live = await readRequest<LibraryEntity | undefined>(store.get(row.id));
          const liveBinding = await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(id));
          if (!active() || liveScope?.accountId !== scope.accountId || liveScope.rootId !== scope.rootId
            || !live || live.entry.deleted || signature(live) !== signature(row)
            || JSON.stringify(liveBinding) !== JSON.stringify(binding)) return false;
          await readRequest(store.put({ ...live, cacheWarning: message })); return true;
        }, false);
        if (changed) for (const listener of listeners) listener(id, message);
      }
      // 検証済みの版だけを短期間共有する。新しい版の取得は利用者の再選択時。
      current.checked.set(id, { signature: signature(row), at: Date.now() });
    } catch {
      if (active()) for (const listener of listeners) listener(id, "Driveの更新を確認できませんでした。端末の内容は保持しています。");
    }
  }
}
