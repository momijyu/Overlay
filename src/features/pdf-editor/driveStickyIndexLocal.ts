import { activeDriveSources, adoptionSignature, type SourceVersion } from "./driveVersionData";
import { readRequest, withLocalTransaction } from "./localDatabase";
import { libraryScope } from "./driveLibraryLocal";
import { notifyLibraryChanged } from "./driveLibraryEvents";
import type { LibraryEntity, LibraryScope } from "./driveLibraryData";
import type { DriveBinding } from "./driveOutbox";
import type { DriveStickyCache } from "./driveStickyIndexData";
import type { SavedNoteSummary } from "./types";

export async function captureStickyIndexes(scope: LibraryScope) {
  return withLocalTransaction(["driveBindings", "noteSummaries", "driveSettings", "driveEntities"], "readonly", async (tx) => {
    const current = await libraryScope(tx);
    if (current?.accountId !== scope.accountId || current.rootId !== scope.rootId) throw new Error("付箋索引の連携先が変わりました。");
    const jobs: { binding: DriveBinding; summary: SavedNoteSummary }[] = [];
    for (const binding of await readRequest<DriveBinding[]>(tx.objectStore("driveBindings").getAll())) {
      if (!binding.enabled || !binding.ids || binding.accountId !== scope.accountId || binding.rootId !== scope.rootId
        || !binding.uploadedGeneration || binding.generation !== binding.uploadedGeneration || binding.error) continue;
      const entity = await readRequest<LibraryEntity | undefined>(tx.objectStore("driveEntities").get(`note:${binding.id}`));
      const summary = await readRequest<SavedNoteSummary | undefined>(tx.objectStore("noteSummaries").get(binding.id));
      // 本文が確認済みで、階層にも公開された同じ保存先だけを索引にする。
      if (summary && !summary.stickyNotesPending && !entity?.entry.deleted && entity?.sources.some((s) => s.noteId === binding.ids!.note)) {
        // 本文を整理した後の一覧は複数版の付箋を含み得る。自分の保存先へ他版を混ぜない。
        jobs.push({ binding, summary: { ...summary, stickyNotes: summary.stickyNotes?.filter((entry) => !entry.sourceId || entry.sourceId === binding.ids!.note) } });
      }
    }
    return jobs;
  });
}

export async function applyStickyIndexes(scope: LibraryScope, snapshots: LibraryEntity[], results: Map<string, DriveStickyCache[]>, active: () => boolean = () => true, versions = new Map<string, SourceVersion[]>()) {
  let changed = false;
  const recheck: LibraryEntity[] = [];
  await withLocalTransaction(["driveSettings", "driveEntities", "driveBindings", "noteSummaries", "notes"], "readwrite", async (tx) => {
    const currentScope = await libraryScope(tx);
    if (!active() || currentScope?.accountId !== scope.accountId || currentScope.rootId !== scope.rootId) throw new Error("付箋索引の連携先が変わりました。");
    for (const before of snapshots) {
      if (!active()) throw new Error("付箋索引の接続が変わりました。");
      const caches = results.get(before.id); if (!caches) continue;
      const store = tx.objectStore("driveEntities");
      const current = await readRequest<LibraryEntity | undefined>(store.get(before.id));
      if (!current || current.entry.deleted || current.head !== before.head || JSON.stringify(current.sources) !== JSON.stringify(before.sources) || adoptionSignature(current) !== adoptionSignature(before) || JSON.stringify(current.sourceVersions) !== JSON.stringify(before.sourceVersions)) continue;
      const sourceVersions = versions.get(before.id) ?? current.sourceVersions;
      const versionsChanged = JSON.stringify(sourceVersions) !== JSON.stringify(current.sourceVersions);
      const next = { ...current, stickyIndexes: caches, ...(sourceVersions ? { sourceVersions } : {}) };
      if (JSON.stringify(current.stickyIndexes) !== JSON.stringify(caches) || versionsChanged) {
        await readRequest(store.put(next));
      }
      const binding = await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(current.entry.id));
      if (versionsChanged) { changed = true; if (next.cachedSource) recheck.push(next); }
      // 端末の本文・確定済み付箋・未送信の編集を、遅れて届いた索引で置換しない。
      if (binding && binding.generation > binding.uploadedGeneration || await readRequest(tx.objectStore("notes").getKey(current.entry.id))) continue;
      const summaries = tx.objectStore("noteSummaries");
      const summary = await readRequest<SavedNoteSummary | undefined>(summaries.get(current.entry.id));
      if (!summary) continue;
      const sources = activeDriveSources(next);
      const entries = [...sources].sort((a, b) => a.noteId.localeCompare(b.noteId)).flatMap((source) => (caches.find((c) => c.sourceId === source.noteId)?.entries ?? [])
        .map((entry) => ({ ...entry, sourceId: source.noteId })));
      const pending = sources.some((source) => !caches.some((cache) => cache.sourceId === source.noteId));
      if (JSON.stringify(summary.stickyNotes ?? []) !== JSON.stringify(entries) || !!summary.stickyNotesPending !== pending) {
        await readRequest(summaries.put({ ...summary, stickyNotes: entries, stickyNotesPending: pending }));
        changed = true;
      }
    }
  }, false);
  if (changed) notifyLibraryChanged();
  if (recheck.length) {
    const { queueDriveCacheCheck } = await import("./driveCacheChecks");
    for (const row of recheck) queueDriveCacheCheck(row.entry.id, row);
  }
}
