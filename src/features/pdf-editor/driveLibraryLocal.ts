import { notifyLibraryChanged } from "./driveLibraryEvents";
import { readRequest, withLocalTransaction } from "./localDatabase";
import { LibraryRetry, entityKey, type LibraryConflictItem, type LibraryEntity, type LibraryEntry, type LibraryEvent, type LibraryEventRow, type LibraryScope, type LibrarySource } from "./driveLibraryData";
import type { DriveBinding } from "./driveOutbox";
import type { NoteFolder, SavedNoteSummary } from "./types";

export const LIBRARY_STORES = ["driveEntities", "driveTreeEvents", "driveSettings", "driveBindings", "noteSummaries", "folders", "notes", "pdfs"] as const;
export async function libraryScope(tx: IDBTransaction): Promise<LibraryScope | null> {
  return (await readRequest<{ value: LibraryScope } | undefined>(tx.objectStore("driveSettings").get("library")))?.value ?? null;
}
export async function getLibraryScope() {
  return withLocalTransaction(["driveSettings"], "readonly", libraryScope);
}
export async function libraryDevice(tx: IDBTransaction) {
  const store = tx.objectStore("driveSettings");
  const device = await readRequest<{ value: string } | undefined>(store.get("device"));
  if (device) return device.value;
  const value = crypto.randomUUID(); await readRequest(store.put({ id: "device", value })); return value;
}
async function queueEvent(tx: IDBTransaction, event: LibraryEvent) {
  await readRequest(tx.objectStore("driveTreeEvents").add({ id: event.id, event, sent: false } satisfies LibraryEventRow));
  await readRequest(tx.objectStore("driveSettings").put({ id: "tree-pending", value: true }));
}
async function ensureBinding(tx: IDBTransaction, scope: LibraryScope, id: string) {
  const store = tx.objectStore("driveBindings");
  const existing = await readRequest<DriveBinding | undefined>(store.get(id));
  if (existing) {
    if (existing.accountId !== scope.accountId || existing.rootId !== scope.rootId) throw new Error("別アカウントの送信待ちがあります。連携先を確認してください。");
    return;
  }
  // Driveの一覧だけを取得したノートは、本文を取得して編集するまで送信対象にしない。
  if (!await readRequest(tx.objectStore("notes").getKey(id))) return;
  const now = Date.now();
  await readRequest(store.add({ id, key: crypto.randomUUID(), deviceId: scope.deviceId, accountId: scope.accountId, rootId: scope.rootId,
    enabled: true, generation: 1, uploadedGeneration: 0, dirtySince: now, changedAt: now } satisfies DriveBinding));
}

// 本文を実際に保存した1件だけ登録する。閲覧用キャッシュは自動登録しない。
export async function enrollDriveNote(tx: IDBTransaction, id: string) {
  const scope = await libraryScope(tx);
  if (scope) await ensureBinding(tx, scope, id);
}

export async function checkDriveFolderDeletion(tx: IDBTransaction, folderIds: Set<string>, selectedKeys: Set<string>) {
  if (!folderIds.size) return;
  const rows = await readRequest<LibraryEntity[]>(tx.objectStore("driveEntities").getAll());
  if (rows.some((row) => !row.entry.deleted && row.entry.parentId && folderIds.has(row.entry.parentId) && !selectedKeys.has(row.id))) {
    throw new Error("フォルダ内に未選択または初回送信中の項目があります。一覧を更新し、送信完了後に選び直してください。");
  }
}

// 通常の階層変更と同じトランザクション。名前やパスをIDとして使わない。
export async function recordDriveLibrary(tx: IDBTransaction, enrollNotes = true) {
  const scope = await libraryScope(tx); if (!scope) return;
  const store = tx.objectStore("driveEntities");
  const [notes, folders, previous] = await Promise.all([
    readRequest<SavedNoteSummary[]>(tx.objectStore("noteSummaries").getAll()),
    readRequest<NoteFolder[]>(tx.objectStore("folders").getAll()),
    readRequest<LibraryEntity[]>(store.getAll()),
  ]);
  const old = new Map(previous.map((row) => [row.id, row]));
  const entries: LibraryEntry[] = [...folders.map((f) => ({ id: f.id, kind: "folder" as const, name: f.name, parentId: f.parentId })),
    ...notes.map((n) => ({ id: n.id, kind: "note" as const, name: n.title, parentId: n.folderId }))];
  const keys = new Set(entries.map(entityKey));
  // 本文の初回送信前でまだ一覧に載せていない他端末の項目は、一覧からの削除と誤認しない。
  for (const row of previous) if (!keys.has(row.id) && !row.entry.deleted && row.listed !== false) entries.push({ ...row.entry, deleted: true });
  let changes: LibraryEvent["changes"] = [];
  async function flush() {
    if (!changes.length) return;
    const id = crypto.randomUUID();
    await queueEvent(tx, { schemaVersion: 1, kind: "overlay-library-event", id, deviceId: scope!.deviceId, changes });
    for (const { entry } of changes) {
      const key = entityKey(entry); const previous = old.get(key);
      await readRequest(store.put({ ...previous, id: key, entry, head: id, listed: true, sources: previous?.sources ?? [] } satisfies LibraryEntity));
    }
    changes = [];
  }
  for (const entry of entries) {
    const key = entityKey(entry); const previous = old.get(key);
    if (previous?.entry.remoteId) entry.remoteId = previous.entry.remoteId;
    if (previous && previous.entry.name === entry.name && previous.entry.parentId === entry.parentId && !!previous.entry.deleted === !!entry.deleted) continue;
    changes.push({ before: previous?.head ?? null, entry });
    if (changes.length === 100) await flush();
  }
  await flush();
  if (enrollNotes) for (const note of notes) await ensureBinding(tx, scope, note.id);
}

export async function enableDriveLibrary(accountId: string, rootId: string) {
  await withLocalTransaction([...LIBRARY_STORES], "readwrite", async (tx) => {
    const previous = await libraryScope(tx);
    if (previous && (previous.accountId !== accountId || previous.rootId !== rootId)) throw new Error("別アカウントの階層が保存されています。元のアカウントへ接続してください。");
    const scope = { ...previous, accountId, rootId, deviceId: await libraryDevice(tx) };
    await readRequest(tx.objectStore("driveSettings").put({ id: "library", value: scope }));
    await recordDriveLibrary(tx, !previous);
    if (!previous) {
      const store = tx.objectStore("driveBindings");
      for (const row of await readRequest<DriveBinding[]>(store.getAll())) {
        const now = Date.now();
        const verifyAgain = row.generation === row.uploadedGeneration && row.uploadedGeneration > 0;
        await readRequest(store.put({ ...row, enabled: true, error: undefined, retryAt: undefined, failures: 0,
          ...(verifyAgain ? { generation: row.generation + 1, changedAt: now, dirtySince: now } : {}) }));
      }
    }
  }, false);
  notifyLibraryChanged();
}

export async function registerLibrarySource(binding: DriveBinding, fileName: string) {
  if (!binding.ids) return;
  await withLocalTransaction(["driveSettings", "driveEntities", "driveTreeEvents"], "readwrite", async (tx) => {
    const scope = await libraryScope(tx); if (!scope || scope.accountId !== binding.accountId || scope.rootId !== binding.rootId) return;
    const store = tx.objectStore("driveEntities");
    const row = await readRequest<LibraryEntity | undefined>(store.get(`note:${binding.id}`));
    if (!row || row.entry.deleted || row.sources.some((s) => s.noteId === binding.ids!.note)) return;
    const source: LibrarySource = { logicalId: binding.id, noteId: binding.ids!.note, noteKey: binding.key,
      containerId: binding.ids!.container, deviceId: binding.deviceId, fileName, ...(binding.pdfHash ? { pdfHash: binding.pdfHash } : {}) };
    await queueEvent(tx, { schemaVersion: 1, kind: "overlay-library-event", id: crypto.randomUUID(), deviceId: binding.deviceId, changes: [], source });
    await readRequest(store.put({ ...row, sources: [...row.sources, source] }));
  }, false);
}

// ハートビートでは階層全件を取得せず、小さな送信待ちフラグだけ確認する。
export async function readLibraryPending() {
  return withLocalTransaction(["driveSettings"], "readonly", async (tx) => ({
    scope: await libraryScope(tx),
    pending: !!(await readRequest<{ value: boolean } | undefined>(tx.objectStore("driveSettings").get("tree-pending")))?.value,
  }));
}

export async function readLibraryStatus() {
  return withLocalTransaction(["driveSettings", "driveEntities"], "readonly", async (tx) => ({
    scope: await libraryScope(tx), pending: !!(await readRequest<{ value: boolean } | undefined>(tx.objectStore("driveSettings").get("tree-pending")))?.value,
    entities: await readRequest<LibraryEntity[]>(tx.objectStore("driveEntities").getAll()),
  }));
}

export async function readLibraryState() {
  return withLocalTransaction(["driveEntities", "driveTreeEvents", "driveSettings"], "readonly", async (tx) => ({
    scope: await libraryScope(tx),
    entities: await readRequest<LibraryEntity[]>(tx.objectStore("driveEntities").getAll()),
    events: await readRequest<LibraryEventRow[]>(tx.objectStore("driveTreeEvents").getAll()),
  }));
}

export async function applyDriveLibrary(scope: LibraryScope, merged: Map<string, LibraryEntity>, events: LibraryEventRow[]) {
  await withLocalTransaction([...LIBRARY_STORES], "readwrite", async (tx) => {
    const currentScope = await libraryScope(tx);
    if (!currentScope || currentScope.accountId !== scope.accountId || currentScope.rootId !== scope.rootId) throw new Error("連携先が変わりました。");
    const store = tx.objectStore("driveEntities");
    const previous = await readRequest<LibraryEntity[]>(store.getAll());
    const suppliedEvents = new Set(events.map((r) => r.id));
    const pending = await readRequest<LibraryEventRow[]>(tx.objectStore("driveTreeEvents").getAll());
    if (pending.some((r) => !suppliedEvents.has(r.id))) throw new LibraryRetry("確認中に階層が変更されました。次の同期で再確認します。");
    for (const entry of previous) if (!merged.has(entry.id)) throw new Error("Driveの階層履歴が欠けています。端末の一覧は変更していません。");
    for (const row of merged.values()) {
      const old = previous.find((r) => r.id === row.id);
      if (old && old.head !== row.head) {
        const incoming = events.find((r) => r.id === row.head)?.event;
        if (!incoming) throw new Error("階層の更新を確認できません。");
      }
      const binding = await readRequest<DriveBinding | undefined>(tx.objectStore("driveBindings").get(row.entry.id));
      if (row.entry.deleted) {
        if (binding && binding.generation > binding.uploadedGeneration) throw new Error("削除されたノートに未送信の編集があります。端末の内容を残して停止しました。");
        await readRequest(tx.objectStore(row.entry.kind === "folder" ? "folders" : "noteSummaries").delete(row.entry.id));
        if (row.entry.kind === "note") {
          // 元データの実体はDriveへ残す。端末の本文は一覧から隠し、未使用になった後に整理する。
          // 画面に開いている本文を同期処理から削除しない。
          await readRequest(tx.objectStore("driveBindings").delete(row.entry.id));
        }
      } else if (row.entry.kind === "folder") {
        await readRequest(tx.objectStore("folders").put({ id: row.entry.id, name: row.entry.name, parentId: row.entry.parentId }));
      } else {
        const summaryStore = tx.objectStore("noteSummaries");
        const summary = await readRequest<SavedNoteSummary | undefined>(summaryStore.get(row.entry.id));
        const hasBody = !!await readRequest(tx.objectStore("notes").getKey(row.entry.id));
        if (summary || row.sources.length) await readRequest(summaryStore.put({ ...summary, id: row.entry.id, title: row.entry.name,
          folderId: row.entry.parentId, fileName: summary?.fileName ?? row.sources[0].fileName, updatedAt: summary?.updatedAt ?? new Date().toISOString(),
          stickyNotesPending: !hasBody && row.sources.some((source) => !old?.stickyIndexes?.some((index) => index.sourceId === source.noteId)) }));
        // 変わっていない階層同期で全ノート本文を読み直さない。
        if (!old || old.entry.name !== row.entry.name || old.entry.parentId !== row.entry.parentId) {
          const note = await readRequest<Record<string, unknown> | undefined>(tx.objectStore("notes").get(row.entry.id));
          if (note) await readRequest(tx.objectStore("notes").put({ ...note, title: row.entry.name, folderId: row.entry.parentId }));
        }
      }
      const listed = row.entry.kind === "folder" || !!await readRequest(tx.objectStore("noteSummaries").getKey(row.entry.id));
      await readRequest(store.put({ ...old, ...row, listed }));
    }
    for (const event of events) await readRequest(tx.objectStore("driveTreeEvents").put(event));
    await readRequest(tx.objectStore("driveSettings").put({ id: "tree-pending", value: events.some((e) => !e.sent) }));
  }, false);
  notifyLibraryChanged();
}

// 利用者が選んだ配置で分岐を合流させる。旧履歴・PDF・各端末の編集版は削除しない。
export async function resolveLibraryPlacement(conflict: LibraryConflictItem, selectedHead: string) {
  const selected = conflict.versions.find((v) => v.head === selectedHead);
  if (!selected || selected.entry.deleted || conflict.versions.some((v) => v.entry.deleted)) throw new Error("削除が含まれる競合は自動で解決できません。必要なノートを書き出して保管してください。");
  await withLocalTransaction([...LIBRARY_STORES], "readwrite", async (tx) => {
    const scope = await libraryScope(tx); if (!scope) throw new Error("Drive連携先がありません。");
    const store = tx.objectStore("driveEntities");
    const current = await readRequest<LibraryEntity | undefined>(store.get(conflict.key));
    if (!current || !conflict.versions.some((v) => v.head === current.head) || current.entry.remoteId !== selected.entry.remoteId) throw new Error("確認後に階層が変わりました。一覧を更新して選び直してください。");
    const id = crypto.randomUUID(); const entry = selected.entry;
    await queueEvent(tx, { schemaVersion: 1, kind: "overlay-library-event", id, deviceId: scope.deviceId,
      changes: [{ before: conflict.versions.map((v) => v.head), entry }] });
    await readRequest(store.put({ ...current, head: id, entry }));
    if (entry.kind === "folder") await readRequest(tx.objectStore("folders").put({ id: entry.id, name: entry.name, parentId: entry.parentId }));
    else {
      const summaries = tx.objectStore("noteSummaries"); const summary = await readRequest<SavedNoteSummary | undefined>(summaries.get(entry.id));
      if (summary) await readRequest(summaries.put({ ...summary, title: entry.name, folderId: entry.parentId }));
      const notes = tx.objectStore("notes"); const note = await readRequest<Record<string, unknown> | undefined>(notes.get(entry.id));
      if (note) await readRequest(notes.put({ ...note, title: entry.name, folderId: entry.parentId }));
    }
  }, false);
  notifyLibraryChanged();
}
