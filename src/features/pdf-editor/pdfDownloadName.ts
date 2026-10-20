export function pdfDownloadName(noteName: string): string {
  // ノート名は変更せず、ダウンロード名だけをファイル名として使える形にする。
  const base = noteName.trim().replace(/\.pdf$/i, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\p{Cc}/gu, "_")
    .replace(/[. ]+$/, "").trim();
  return `${base || "ノート"}.pdf`;
}
