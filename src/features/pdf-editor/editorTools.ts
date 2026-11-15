import type { EditorTool } from "./types";

// ツールバーと使い方で、道具の順序・名前・用途をそろえる。
export const editorToolGroups: {
  label: string;
  tools: { tool: EditorTool; label: string; description: string }[];
}[] = [
  { label: "移動・選択", tools: [
    { tool: "hand", label: "ページを動かす", description: "ドラッグでページを移動します。書き込み自体は動きません。" },
    { tool: "lasso", label: "投げ縄で選択", description: "線・テキスト・付箋の全体を囲み、まとめて移動・複製します。" },
  ] },
  { label: "描く・消す", tools: [
    { tool: "pen", label: "ペン", description: "ページに手書きします。色と太さを設定できます。" },
    { tool: "marker", label: "マーカー", description: "半透明の線を重ねます。色と太さを設定できます。" },
    { tool: "eraser", label: "消しゴム", description: "描いた線の触れた部分を消します。元PDFの内容は消えません。" },
    { tool: "shape", label: "図形", description: "直線・矢印・四角・楕円を選び、ドラッグで描きます。" },
    { tool: "fill", label: "塗りつぶし", description: "ペンや図形で囲んだ内側を押して塗ります。元PDFの図や文字は境界になりません。" },
  ] },
  { label: "配置する", tools: [
    { tool: "text", label: "テキストボックス", description: "ページ上に直接文字を書きます。文章に合わせて箱の大きさが変わります。" },
    { tool: "sticky", label: "付箋", description: "背景付きのメモを置きます。付箋一覧から、その位置へ戻れます。" },
    { tool: "image", label: "画像", description: "PNG・JPEGやPDFの1ページを画像として置きます。画像は書き込みの背面に表示します。" },
    { tool: "tape", label: "目隠しテープ", description: "復習用に答えを隠します。タップで表示を切り替えます。PDFには出力しません。" },
  ] },
];
