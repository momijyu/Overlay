import { readNotePages, checkPageBindings } from "./notePages";
import { readRequest, withLocalTransaction } from "./localDatabase";
import { canMoveItem, canMoveItems, libraryItems, noteItemKey, selectedMoveRoots, type NoteDragItem } from "./noteDrag";
import { checkedDeletion } from "./noteSelection";
import { canDeleteEmptyFolder, hasFolderNameConflict } from "./noteTree";
import { readStrokes } from "./strokeData";
import { readTextNotes } from "./textData";
import type { NotePage, LoadedNote, NoteFolder, NoteLibrary, PenStroke, SavedNoteSummary, TextNotesByPage } from "./types";
import { readNoteBackup, type NoteBackup } from "./noteBackupData";
import { toLocalNoteSummary } from "./localNoteSummary";

type LocalNote = SavedNoteSummary & { strokesByPage: Record<number, PenStroke[]>; textsByPage?: TextNotesByPage; pages?: NotePage[]; revision?: number };
type LocalPdf = { id: string; blob: Blob };

// 一覧と本文が食い違わないよう、必ず同じトランザクションで更新する。
async function writeLocalNote(transaction: IDBTransaction, note: LocalNote, method: "add" | "put" = "put") {
  await readRequest(transaction.objectStore("notes")[method](note));
  await readRequest(transaction.objectStore("noteSummaries")[method](toLocalNoteSummary(note)));
}

async function deleteLocalNote(transaction: IDBTransaction, id: string) {
  await readRequest(transaction.objectStore("notes").delete(id));
  await readRequest(transaction.objectStore("pdfs").delete(id));
  await readRequest(transaction.objectStore("noteSummaries").delete(id));
}

// 同じreadonlyトランザクションで階層・ノート・元PDFを取得する。
// 読み取り中に別タブが移動・削除しても、途中の階層を混ぜない。
export async function captureNoteBackup(item: NoteDragItem): Promise<NoteBackup> {
  return captureBackup([item], false);
}

export async function captureSelectedNoteBackup(items: NoteDragItem[]): Promise<NoteBackup> {
  return captureBackup(items, true);
}

async function captureBackup(items: NoteDragItem[], selection: boolean): Promise<NoteBackup> {
  const snapshot = await withLocalTransaction(["notes", "pdfs", "folders", "noteSummaries"], "readonly", async (transaction) => {
    const library = await readLibrary(transaction);
    const keys = new Set(items.map(noteItemKey));
    const existing = new Set(libraryItems(library).map(noteItemKey));
    if (!items.length || [...keys].some((key) => !existing.has(key))) {
      throw new Error("対象が見つかりません。一覧を更新してください。");
    }
    const item = items[0];
    const selected = item.kind === "note" ? library.notes.find((note) => note.id === item.id)
      : library.folders.find((folder) => folder.id === item.id);
    if (!selected) throw new Error("対象が見つかりません。一覧を更新してください。");
    const included = new Set<string>(items.filter((item) => item.kind === "folder").map((item) => item.id));
    if (selection) {
      // チェック後に増えた子を勝手に含めず、最新一覧での選び直しを求める。
      if (library.folders.some((folder) => folder.parentId && included.has(folder.parentId) && !included.has(folder.id))
        || library.notes.some((note) => note.folderId && included.has(note.folderId) && !keys.has(`note:${note.id}`))) {
        throw new Error("選択したフォルダの中身が変わりました。一覧を更新して選び直してください。");
      }
    } else {
      for (let size = -1; size !== included.size;) {
        size = included.size;
        for (const folder of library.folders) if (folder.parentId && included.has(folder.parentId)) included.add(folder.id);
      }
    }
    const folders = library.folders.filter((folder) => included.has(folder.id))
      .map((folder) => ({ ...folder, parentId: folder.parentId && included.has(folder.parentId) ? folder.parentId : null }));
    const selectedNotes = library.notes.filter((note) => selection ? keys.has(`note:${note.id}`)
      : item.kind === "note" ? note.id === item.id : !!note.folderId && included.has(note.folderId));
    const notes = await Promise.all(selectedNotes.map(async (summary) => {
      const [note, pdf] = await Promise.all([
        readRequest<LocalNote | undefined>(transaction.objectStore("notes").get(summary.id)),
        readRequest<LocalPdf | undefined>(transaction.objectStore("pdfs").get(summary.id)),
      ]);
      if (!note || !pdf) throw new Error("バックアップに必要な元PDFが見つかりません。");
      return { id: note.id, title: note.title, fileName: note.fileName,
        folderId: note.folderId && included.has(note.folderId) ? note.folderId : null,
        strokesByPage: note.strokesByPage, textsByPage: note.textsByPage ?? {}, ...(note.pages ? { pages: note.pages } : {}), pdf: pdf.blob };
    }));
    return { schemaVersion: notes.some((note) => note.pages) ? 3 : selection ? 2 : 1, kind: selection ? "selection" : item.kind,
      name: selection ? "Overlay-選択項目" : "title" in selected ? selected.title : selected.name, folders, notes };
  });
  return readNoteBackup(snapshot);
}

// 解析済みバックアップを新しいIDで追加する。途中の失敗では全件ロールバックする。
export async function restoreNoteBackup(input: NoteBackup, options: { skipDuplicates?: boolean } = {}): Promise<{ notes: number; folders: number; skippedNotes?: number }> {
  const backup = readNoteBackup(input);
  if (options.skipDuplicates && backup.kind !== "note") throw new Error("重複確認は単独ノートの復元に対応しています。");
  const checkDuplicateNote = options.skipDuplicates
    ? await (await import("./noteDuplicates")).prepareNoteDeduplication(backup.notes[0]) : null;
  const folderIds = new Map(backup.folders.map((folder) => [folder.id, crypto.randomUUID()]));
  const notes = backup.notes.map((note) => ({ ...note, id: crypto.randomUUID() }));
  const skipped = await withLocalTransaction(["notes", "pdfs", "folders", "noteSummaries"], "readwrite", async (transaction) => {
    if (checkDuplicateNote && await checkDuplicateNote(transaction)) return true;
    const library = await readLibrary(transaction);
    for (const folder of backup.folders) {
      let name = folder.name;
      if (folder.parentId === null) {
        let suffix = 1;
        while (hasFolderNameConflict(name, null, library)) {
          const ending = `（復元${suffix++}）`;
          name = [...folder.name].slice(0, 80 - [...ending].length).join("") + ending;
        }
      }
      const restoredFolder = { id: folderIds.get(folder.id)!, name,
        parentId: folder.parentId === null ? null : folderIds.get(folder.parentId)! };
      await readRequest(transaction.objectStore("folders").add(restoredFolder));
      // 今回のZIP内の別の根とも衝突させない。
      library.folders.push(restoredFolder);
    }
    const updatedAt = new Date().toISOString();
    for (const note of notes) {
      await readRequest(transaction.objectStore("pdfs").add({ id: note.id, blob: note.pdf }));
      await writeLocalNote(transaction, { id: note.id, title: note.title, fileName: note.fileName,
        folderId: note.folderId === null ? null : folderIds.get(note.folderId)!, updatedAt, revision: 1,
        strokesByPage: note.strokesByPage, textsByPage: note.textsByPage, ...(note.pages ? { pages: note.pages } : {}) }, "add");
    }
    return false;
  });
  return { notes: skipped ? 0 : notes.length, folders: backup.folders.length,
    ...(checkDuplicateNote ? { skippedNotes: skipped ? 1 : 0 } : {}) };
}

function readRevision(note: LocalNote): number {
  const revision = note.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("保存されたノートの更新番号を確認できませんでした。");
  return revision;
}

function checkedName(value: string, maximum: number): string {
  const name = value.trim();
  if (!name || [...name].length > maximum) throw new Error(`名前は1〜${maximum}文字で入力してください。`);
  return name;
}

async function readLibrary(transaction: IDBTransaction): Promise<NoteLibrary> {
  const [notes, folders] = await Promise.all([
    readRequest<SavedNoteSummary[]>(transaction.objectStore("noteSummaries").getAll()),
    readRequest<NoteFolder[]>(transaction.objectStore("folders").getAll()),
  ]);
  return {
    // 一覧取得では元PDFも編集本文もDBから読み込まない。
    notes: notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    folders, foldersEnabled: true,
  };
}

function checkParent(parentId: string | null, library: NoteLibrary) {
  if (parentId !== null && !library.folders.some((folder) => folder.id === parentId)) {
    throw new Error("保存先のフォルダが見つかりません。一覧を更新してください。");
  }
}

function checkDuplicate(name: string, parentId: string | null, library: NoteLibrary, exceptId?: string) {
  if (hasFolderNameConflict(name, parentId, library, exceptId)) throw new Error("同じ場所に同じ名前のフォルダがあります。");
}

export async function loadNoteLibrary(): Promise<NoteLibrary> {
  return withLocalTransaction(["noteSummaries", "folders"], "readonly", readLibrary);
}

export async function saveLocalNote(input: {
  file: File; strokesByPage: Record<number, PenStroke[]>; noteId: string | null;
  expectedRevision?: number;
  textsByPage?: TextNotesByPage;
  pages?: NotePage[];
}): Promise<string> {
  // 入力を複製・検証してから保存し、保存中に編集されても内容が混ざらないようにする。
  const strokesByPage = readStrokes(input.strokesByPage);
  const textsByPage = input.textsByPage === undefined ? undefined : readTextNotes(input.textsByPage);
  const pages = readNotePages(input.pages);
  checkPageBindings(pages, [strokesByPage, textsByPage ?? {}]);
  const id = input.noteId ?? crypto.randomUUID();
  return withLocalTransaction(["notes", "pdfs", "noteSummaries"], "readwrite", async (transaction) => {
    const notes = transaction.objectStore("notes");
    const pdfs = transaction.objectStore("pdfs");
    const updatedAt = new Date().toISOString();
    if (input.noteId) {
      const [existing, pdf] = await Promise.all([
        readRequest<LocalNote | undefined>(notes.get(id)),
        readRequest<LocalPdf | undefined>(pdfs.get(id)),
      ]);
      if (!existing || !pdf) throw new Error("保存済みノートが見つかりません。別のノートとして自動保存はしません。未保存の内容はPDFをダウンロードしてください。");
      const revision = readRevision(existing);
      if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
        throw new Error("別のタブでこのノートが更新されています。上書きしていません。必要な内容をPDFへ書き出してからノートを開き直してください。");
      }
      checkPageBindings("pages" in input ? pages : existing.pages, [strokesByPage, textsByPage ?? existing.textsByPage ?? {}]);
      await writeLocalNote(transaction, { ...existing, strokesByPage, ...("pages" in input ? { pages } : {}),
        ...(textsByPage === undefined ? {} : { textsByPage }), updatedAt, revision: revision + 1 });
    } else {
      if (input.file.size === 0) throw new Error("空のPDFは保存できません。");
      const title = (input.file.name.replace(/\.pdf$/i, "") || input.file.name).slice(0, 120);
      const note: LocalNote = { id, title, fileName: input.file.name, folderId: null, updatedAt, strokesByPage,
        textsByPage: textsByPage ?? {}, ...(pages ? { pages } : {}), revision: 1 };
      // 元PDFと線は別ストアだが、片方だけ保存されないよう同じトランザクションにする。
      await readRequest(pdfs.add({ id, blob: input.file.slice(0, input.file.size, "application/pdf") } satisfies LocalPdf));
      await writeLocalNote(transaction, note, "add");
    }
    return id;
  });
}

export async function loadLocalNote(noteId: string): Promise<LoadedNote> {
  return withLocalTransaction(["notes", "pdfs"], "readonly", async (transaction) => {
    const [note, pdf] = await Promise.all([
      readRequest<LocalNote | undefined>(transaction.objectStore("notes").get(noteId)),
      readRequest<LocalPdf | undefined>(transaction.objectStore("pdfs").get(noteId)),
    ]);
    if (!note || !pdf || !(pdf.blob instanceof Blob) || pdf.blob.size === 0) {
      throw new Error("このブラウザにノートの元PDFが見つかりません。保存時と同じブラウザ・URLか確認してください。");
    }
    const pages = readNotePages(note.pages);
    checkPageBindings(pages, [note.strokesByPage, note.textsByPage ?? {}]);
    return { ...(pages ? { pages } : {}), id: note.id, file: new File([pdf.blob], note.fileName, { type: "application/pdf" }),
      strokesByPage: readStrokes(note.strokesByPage), textsByPage: readTextNotes(note.textsByPage), revision: readRevision(note) };
  });
}

export async function deleteSavedNote(noteId: string): Promise<void> {
  await withLocalTransaction(["notes", "pdfs", "noteSummaries"], "readwrite", async (transaction) => {
    const notes = transaction.objectStore("notes");
    if (!await readRequest(notes.get(noteId))) throw new Error("削除するノートが見つかりません。一覧を更新してください。");
    // 片方の削除に失敗したら両方取り消す。元PDFが欠けたノートも削除できる。
    await deleteLocalNote(transaction, noteId);
  });
}

export async function deleteSavedItems(items: NoteDragItem[]): Promise<void> {
  // 呼び出し後に配列が変わっても、確認時の対象を増減させない。
  const confirmed = items.map((item) => ({ ...item }));
  await withLocalTransaction(["notes", "pdfs", "folders", "noteSummaries"], "readwrite", async (transaction) => {
    const targets = checkedDeletion(confirmed, await readLibrary(transaction));
    for (const item of targets) {
      if (item.kind === "note") {
        await deleteLocalNote(transaction, item.id);
      } else {
        await readRequest(transaction.objectStore("folders").delete(item.id));
      }
    }
    // 1件でも失敗したら本文・PDF・一覧・フォルダを全てロールバックする。
  });
}

export async function createNoteFolder(name: string, parentId: string | null): Promise<string> {
  const trimmedName = checkedName(name, 100);
  return withLocalTransaction(["noteSummaries", "folders"], "readwrite", async (transaction) => {
    const library = await readLibrary(transaction);
    checkParent(parentId, library);
    checkDuplicate(trimmedName, parentId, library);
    const id = crypto.randomUUID();
    await readRequest(transaction.objectStore("folders").add({ id, name: trimmedName, parentId } satisfies NoteFolder));
    return id;
  });
}

// 整理操作は最新の階層を同一トランザクションで再確認する。別タブとの競合も直列に処理する。
export async function organizeNote(noteId: string, title: string, folderId: string | null): Promise<void> {
  const trimmedTitle = checkedName(title, 120);
  await withLocalTransaction(["notes", "folders", "noteSummaries"], "readwrite", async (transaction) => {
    checkParent(folderId, await readLibrary(transaction));
    const notes = transaction.objectStore("notes");
    const note = await readRequest<LocalNote | undefined>(notes.get(noteId));
    if (!note) throw new Error("変更するノートが見つかりません。");
    await writeLocalNote(transaction, { ...note, title: trimmedTitle, folderId, updatedAt: new Date().toISOString() });
  });
}

export async function moveSavedNote(noteId: string, folderId: string | null): Promise<void> {
  await withLocalTransaction(["notes", "folders", "noteSummaries"], "readwrite", async (transaction) => {
    checkParent(folderId, await readLibrary(transaction));
    const notes = transaction.objectStore("notes");
    const note = await readRequest<LocalNote | undefined>(notes.get(noteId));
    if (!note) throw new Error("移動するノートが見つかりません。");
    await writeLocalNote(transaction, { ...note, folderId, updatedAt: new Date().toISOString() });
  });
}

export async function moveNoteFolder(folderId: string, parentId: string | null): Promise<void> {
  await withLocalTransaction(["noteSummaries", "folders"], "readwrite", async (transaction) => {
    const library = await readLibrary(transaction);
    if (!canMoveItem({ kind: "folder", id: folderId }, parentId, library)) {
      throw new Error("移動できません。現在の場所・自己や子孫・同名フォルダとの衝突を確認してください。");
    }
    const folder = library.folders.find((folder) => folder.id === folderId)!;
    await readRequest(transaction.objectStore("folders").put({ ...folder, parentId }));
  });
}

export async function moveSavedItems(items: NoteDragItem[], parentId: string | null): Promise<void> {
  await withLocalTransaction(["notes", "folders", "noteSummaries"], "readwrite", async (transaction) => {
    const library = await readLibrary(transaction);
    if (!canMoveItems(items, parentId, library)) {
      throw new Error("移動できません。項目の存在・現在の場所・自己や子孫・同名フォルダを確認してください。");
    }
    // 一部だけ移動して失敗しないよう、全件を同じトランザクションへ含める。
    for (const item of selectedMoveRoots(items, library)) {
      if (item.kind === "folder") {
        const folder = library.folders.find((entry) => entry.id === item.id)!;
        if (folder.parentId !== parentId) await readRequest(transaction.objectStore("folders").put({ ...folder, parentId }));
      } else {
        const notes = transaction.objectStore("notes");
        const note = await readRequest<LocalNote>(notes.get(item.id));
        if (note.folderId !== parentId) {
          await writeLocalNote(transaction, { ...note, folderId: parentId, updatedAt: new Date().toISOString() });
        }
      }
    }
  });
}

export async function renameNoteFolder(folderId: string, name: string): Promise<void> {
  const trimmedName = checkedName(name, 100);
  await withLocalTransaction(["noteSummaries", "folders"], "readwrite", async (transaction) => {
    const library = await readLibrary(transaction);
    const folder = library.folders.find((folder) => folder.id === folderId);
    if (!folder) throw new Error("変更するフォルダが見つかりません。");
    checkDuplicate(trimmedName, folder.parentId, library, folderId);
    await readRequest(transaction.objectStore("folders").put({ ...folder, name: trimmedName }));
  });
}

export async function deleteEmptyNoteFolder(folderId: string): Promise<void> {
  await withLocalTransaction(["noteSummaries", "folders"], "readwrite", async (transaction) => {
    if (!canDeleteEmptyFolder(folderId, await readLibrary(transaction))) throw new Error("空のフォルダだけ削除できます。中のノートやフォルダを先に移動してください。");
    await readRequest(transaction.objectStore("folders").delete(folderId));
  });
}
