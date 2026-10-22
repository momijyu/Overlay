import { readRequest, withLocalTransaction } from "./localDatabase";
import { canMoveItem, canMoveItems, selectedMoveRoots, type NoteDragItem } from "./noteDrag";
import { checkedDeletion } from "./noteSelection";
import { canDeleteEmptyFolder, hasFolderNameConflict } from "./noteTree";
import { readStrokes } from "./strokeData";
import { readTextNotes } from "./textData";
import type { LoadedNote, NoteFolder, NoteLibrary, PenStroke, SavedNoteSummary, TextNotesByPage } from "./types";

type LocalNote = SavedNoteSummary & { strokesByPage: Record<number, PenStroke[]>; textsByPage?: TextNotesByPage; revision?: number };
type LocalPdf = { id: string; blob: Blob };

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
    readRequest<LocalNote[]>(transaction.objectStore("notes").getAll()),
    readRequest<NoteFolder[]>(transaction.objectStore("folders").getAll()),
  ]);
  return {
    // 一覧に元PDFや線を渡さず、編集時だけ必要なデータを読み込む。
    notes: notes.map(({ id, title, fileName, folderId, updatedAt }) => ({ id, title, fileName, folderId, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
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
  return withLocalTransaction(["notes", "folders"], "readonly", readLibrary);
}

export async function saveLocalNote(input: {
  file: File; strokesByPage: Record<number, PenStroke[]>; noteId: string | null;
  expectedRevision?: number;
  textsByPage?: TextNotesByPage;
}): Promise<string> {
  // 入力を複製・検証してから保存し、保存中に編集されても内容が混ざらないようにする。
  const strokesByPage = readStrokes(input.strokesByPage);
  const textsByPage = input.textsByPage === undefined ? undefined : readTextNotes(input.textsByPage);
  const id = input.noteId ?? crypto.randomUUID();
  return withLocalTransaction(["notes", "pdfs"], "readwrite", async (transaction) => {
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
      await readRequest(notes.put({ ...existing, strokesByPage,
        ...(textsByPage === undefined ? {} : { textsByPage }), updatedAt, revision: revision + 1 }));
    } else {
      if (input.file.size === 0) throw new Error("空のPDFは保存できません。");
      const title = (input.file.name.replace(/\.pdf$/i, "") || input.file.name).slice(0, 120);
      const note: LocalNote = { id, title, fileName: input.file.name, folderId: null, updatedAt, strokesByPage,
        textsByPage: textsByPage ?? {}, revision: 1 };
      // 元PDFと線は別ストアだが、片方だけ保存されないよう同じトランザクションにする。
      await readRequest(pdfs.add({ id, blob: input.file.slice(0, input.file.size, "application/pdf") } satisfies LocalPdf));
      await readRequest(notes.add(note));
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
    return { id: note.id, file: new File([pdf.blob], note.fileName, { type: "application/pdf" }),
      strokesByPage: readStrokes(note.strokesByPage), textsByPage: readTextNotes(note.textsByPage), revision: readRevision(note) };
  });
}

export async function deleteSavedNote(noteId: string): Promise<void> {
  await withLocalTransaction(["notes", "pdfs"], "readwrite", async (transaction) => {
    const notes = transaction.objectStore("notes");
    if (!await readRequest(notes.get(noteId))) throw new Error("削除するノートが見つかりません。一覧を更新してください。");
    // 片方の削除に失敗したら両方取り消す。元PDFが欠けたノートも削除できる。
    await readRequest(notes.delete(noteId));
    await readRequest(transaction.objectStore("pdfs").delete(noteId));
  });
}

export async function deleteSavedItems(items: NoteDragItem[]): Promise<void> {
  // 呼び出し後に配列が変わっても、確認時の対象を増減させない。
  const confirmed = items.map((item) => ({ ...item }));
  await withLocalTransaction(["notes", "pdfs", "folders"], "readwrite", async (transaction) => {
    const targets = checkedDeletion(confirmed, await readLibrary(transaction));
    for (const item of targets) {
      if (item.kind === "note") {
        await readRequest(transaction.objectStore("notes").delete(item.id));
        await readRequest(transaction.objectStore("pdfs").delete(item.id));
      } else {
        await readRequest(transaction.objectStore("folders").delete(item.id));
      }
    }
    // 1件でも失敗したらnotes・pdfs・foldersを全てロールバックする。
  });
}

export async function createNoteFolder(name: string, parentId: string | null): Promise<string> {
  const trimmedName = checkedName(name, 100);
  return withLocalTransaction(["notes", "folders"], "readwrite", async (transaction) => {
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
  await withLocalTransaction(["notes", "folders"], "readwrite", async (transaction) => {
    checkParent(folderId, await readLibrary(transaction));
    const notes = transaction.objectStore("notes");
    const note = await readRequest<LocalNote | undefined>(notes.get(noteId));
    if (!note) throw new Error("変更するノートが見つかりません。");
    await readRequest(notes.put({ ...note, title: trimmedTitle, folderId, updatedAt: new Date().toISOString() }));
  });
}

export async function moveSavedNote(noteId: string, folderId: string | null): Promise<void> {
  await withLocalTransaction(["notes", "folders"], "readwrite", async (transaction) => {
    checkParent(folderId, await readLibrary(transaction));
    const notes = transaction.objectStore("notes");
    const note = await readRequest<LocalNote | undefined>(notes.get(noteId));
    if (!note) throw new Error("移動するノートが見つかりません。");
    await readRequest(notes.put({ ...note, folderId, updatedAt: new Date().toISOString() }));
  });
}

export async function moveNoteFolder(folderId: string, parentId: string | null): Promise<void> {
  await withLocalTransaction(["notes", "folders"], "readwrite", async (transaction) => {
    const library = await readLibrary(transaction);
    if (!canMoveItem({ kind: "folder", id: folderId }, parentId, library)) {
      throw new Error("移動できません。現在の場所・自己や子孫・同名フォルダとの衝突を確認してください。");
    }
    const folder = library.folders.find((folder) => folder.id === folderId)!;
    await readRequest(transaction.objectStore("folders").put({ ...folder, parentId }));
  });
}

export async function moveSavedItems(items: NoteDragItem[], parentId: string | null): Promise<void> {
  await withLocalTransaction(["notes", "folders"], "readwrite", async (transaction) => {
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
          await readRequest(notes.put({ ...note, folderId: parentId, updatedAt: new Date().toISOString() }));
        }
      }
    }
  });
}

export async function renameNoteFolder(folderId: string, name: string): Promise<void> {
  const trimmedName = checkedName(name, 100);
  await withLocalTransaction(["notes", "folders"], "readwrite", async (transaction) => {
    const library = await readLibrary(transaction);
    const folder = library.folders.find((folder) => folder.id === folderId);
    if (!folder) throw new Error("変更するフォルダが見つかりません。");
    checkDuplicate(trimmedName, folder.parentId, library, folderId);
    await readRequest(transaction.objectStore("folders").put({ ...folder, name: trimmedName }));
  });
}

export async function deleteEmptyNoteFolder(folderId: string): Promise<void> {
  await withLocalTransaction(["notes", "folders"], "readwrite", async (transaction) => {
    if (!canDeleteEmptyFolder(folderId, await readLibrary(transaction))) throw new Error("空のフォルダだけ削除できます。中のノートやフォルダを先に移動してください。");
    await readRequest(transaction.objectStore("folders").delete(folderId));
  });
}
