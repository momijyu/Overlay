import { strFromU8, strToU8, unzipSync, zip } from "fflate";
import { BACKUP_LIMITS, readNoteBackup, type NoteBackup, type BackupNote } from "./noteBackupData";

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
// 破損検出用であり、暗号化・署名・改ざん防止ではない。
function checksum(bytes: Uint8Array): string {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return ((value ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

async function checkPdf(bytes: Uint8Array, note: BackupNote) {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    const pages = pdf.getPageCount();
    if (pages < 1 || pages > 10_000 || [...Object.keys(note.strokesByPage), ...Object.keys(note.textsByPage)]
      .some((page) => Number(page) > pages)) throw new Error("ページ数不一致");
  } catch {
    throw new Error(`「${note.title}」の元PDFまたは書き込みのページ数を確認できません。暗号化PDFには対応していません。`);
  }
}

export async function encodeNoteBackup(input: NoteBackup): Promise<Blob> {
  const backup = readNoteBackup(input);
  const entries: Record<string, Uint8Array> = Object.create(null);
  const notes = [];
  for (const [index, note] of backup.notes.entries()) {
    const bytes = new Uint8Array(await note.pdf.arrayBuffer());
    await checkPdf(bytes, note);
    entries[`pdfs/${index}.pdf`] = bytes;
    notes.push({ id: note.id, title: note.title, fileName: note.fileName, folderId: note.folderId,
      strokesByPage: note.strokesByPage, textsByPage: note.textsByPage, pdfChecksum: checksum(bytes) });
    // 複数PDFの解析の間に、進捗表示の描画をブラウザへ返す。
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const manifest = strToU8(JSON.stringify({ ...backup, app: "Overlay", notes }));
  if (manifest.length > BACKUP_LIMITS.jsonBytes) throw new Error("編集情報が大きすぎます。ノートを分けて書き出してください。");
  entries["manifest.json"] = manifest;
  entries["manifest.crc"] = strToU8(checksum(manifest));
  const archiveSize = Object.entries(entries).reduce((total, [name, data]) => total + data.length + 76 + name.length * 2, 22);
  if (archiveSize > BACKUP_LIMITS.bytes) throw new Error("バックアップは合計256MiB以下に分けてください。");
  // PDFを再圧縮しないZIP。読み込みも同じ無圧縮形式だけ受け付け、展開爆弾を避ける。
  const bytes = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    zip(entries, { level: 0 }, (error, data) => { if (error) reject(error); else resolve(data); });
  });
  if (bytes.length > BACKUP_LIMITS.bytes) throw new Error("バックアップは合計256MiB以下に分けてください。");
  return new Blob([bytes], { type: backup.kind === "selection" ? "application/zip" : "application/octet-stream" });
}

export async function decodeNoteBackup(file: Blob): Promise<NoteBackup> {
  if (file.size === 0 || file.size > BACKUP_LIMITS.bytes) throw new Error("256MiB以下のOverlayバックアップを選択してください。");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const names = new Set<string>();
    let total = 0;
    const entries = unzipSync(bytes, { filter: (entry) => {
      total += entry.originalSize;
      if (names.has(entry.name) || names.size >= BACKUP_LIMITS.notes + 2
        || !/^(manifest\.json|manifest\.crc|pdfs\/(0|[1-9]\d{0,2})\.pdf)$/.test(entry.name)
        || entry.compression !== 0 || entry.size !== entry.originalSize
        || total > BACKUP_LIMITS.bytes || entry.originalSize > bytes.length
        || (entry.name === "manifest.json" && entry.originalSize > BACKUP_LIMITS.jsonBytes)
        || (entry.name === "manifest.crc" && entry.originalSize !== 8)) {
        throw new Error("バックアップの梱包形式が不正です。");
      }
      names.add(entry.name);
      return true;
    } });
    const manifest = entries["manifest.json"];
    const crc = entries["manifest.crc"];
    if (!manifest || !crc || checksum(manifest) !== strFromU8(crc)) throw new Error("バックアップが破損しています。");
    const data = JSON.parse(strFromU8(manifest));
    if (!data || data.app !== "Overlay") throw new Error("Overlayのバックアップではありません。");
    if (data.schemaVersion !== 1 && data.schemaVersion !== 2) throw new Error("このバックアップの形式バージョンには対応していません。");
    if (!Array.isArray(data.notes) || data.notes.length > BACKUP_LIMITS.notes
      || names.size !== data.notes.length + 2) throw new Error("バックアップの元PDFが不足または重複しています。");
    const backup = readNoteBackup({ ...data, notes: data.notes.map((note: unknown, index: number) => {
      const pdf = entries[`pdfs/${index}.pdf`];
      if (!note || typeof note !== "object" || !pdf || !("pdfChecksum" in note)
        || note.pdfChecksum !== checksum(pdf)) throw new Error("バックアップの元PDFが破損しています。");
      return { ...note, pdf: new Blob([new Uint8Array(pdf)], { type: "application/pdf" }) };
    }) });
    for (const [index, note] of backup.notes.entries()) {
      await checkPdf(entries[`pdfs/${index}.pdf`], note);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return backup;
  } catch (error) {
    throw new Error(`バックアップを読み込めませんでした。${error instanceof Error ? error.message : "形式を確認してください。"}`, { cause: error });
  }
}
