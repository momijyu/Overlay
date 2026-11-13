import { readPageHeadings } from "./pageHeadings";
import { readNotePages } from "./notePages";
import { readRequest, withLocalTransaction } from "./localDatabase";
import type { BackupNote } from "./noteBackupData";
import { readStrokes } from "./strokeData";
import { readTextNotes } from "./textData";

type StoredNote = {
  images?: import("./types").NoteImages; id: string; revision?: number; strokesByPage: unknown; textsByPage?: unknown; pages?: unknown; headingsByPage?: unknown };

function editingKey(note: { images?: import("./types").NoteImages; strokesByPage: unknown; textsByPage?: unknown; pages?: unknown; headingsByPage?: unknown }): string {
  // 空の書き込み配列は差にしない。白紙の配置・寸法と見出しは編集内容として比較する。
  const nonempty = (pages: Record<number, unknown[]>) => Object.fromEntries(Object.entries(pages).filter(([, items]) => items.length));
  const pages = readNotePages(note.pages);
  const layout = pages?.some((page) => page.kind === "blank") ? pages : undefined;
  return JSON.stringify([note.images?.byPage ?? {},layout, readPageHeadings(note.headingsByPage), nonempty(readStrokes(note.strokesByPage)), nonempty(readTextNotes(note.textsByPage))]);
}

async function samePdf(first: Blob, second: Blob): Promise<boolean> {
  if (first.size !== second.size) return false;
  // PDF全体や全ライブラリを同時にメモリへ展開しない。ハッシュ等の保存データも増やさない。
  const chunkBytes = 1024 * 1024;
  for (let offset = 0; offset < first.size; offset += chunkBytes) {
    const a = new Uint8Array(await first.slice(offset, offset + chunkBytes).arrayBuffer());
    const b = new Uint8Array(await second.slice(offset, offset + chunkBytes).arrayBuffer());
    if (a.some((byte, index) => byte !== b[index])) return false;
  }
  return true;
}

// 時間のかかるBlob読み取りはDBトランザクションの外で行い、追加直前に再検証する。
export async function prepareNoteDeduplication(note: BackupNote) {
  const ids = await withLocalTransaction(["noteSummaries"], "readonly", async (tx) =>
    readRequest<IDBValidKey[]>(tx.objectStore("noteSummaries").getAllKeys()));
  const key = editingKey(note);
  const checked = new Map<string, number>();
  let duplicateId: string | null = null;
  for (const id of ids) {
    const candidate = await withLocalTransaction(["notes", "pdfs"], "readonly", async (tx) => {
      const stored = await readRequest<StoredNote | undefined>(tx.objectStore("notes").get(id));
      if (!stored) throw new Error("ノート一覧が変わりました。もう一度復元してください。");
      checked.set(stored.id, stored.revision ?? 0);
      if (editingKey(stored) !== key) return null;
      return readRequest<{ blob: Blob } | undefined>(tx.objectStore("pdfs").get(id));
    });
    if (candidate?.blob instanceof Blob && await samePdf(note.pdf, candidate.blob)) {
      duplicateId = String(id);
      break;
    }
  }
  return async (tx: IDBTransaction): Promise<boolean> => {
    const changed = () => new Error("比較中にノートが変更されました。もう一度復元してください。");
    if (!duplicateId) {
      const currentIds = await readRequest<IDBValidKey[]>(tx.objectStore("noteSummaries").getAllKeys());
      if (currentIds.length !== ids.length || currentIds.some((id, index) => id !== ids[index])) throw changed();
    }
    for (const [id, revision] of checked) {
      if (duplicateId && id !== duplicateId) continue;
      const current = await readRequest<StoredNote | undefined>(tx.objectStore("notes").get(id));
      if (!current || (current.revision ?? 0) !== revision) throw changed();
      // 元PDFの欠落したノートを「復元済み」として扱わない。
      if (id === duplicateId && !await readRequest(tx.objectStore("pdfs").get(id))) throw changed();
    }
    return duplicateId !== null;
  };
}
