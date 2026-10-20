# 編集アイコンの取得元

2026年10月20日のユーザー指示により、先に実装した線画をLucideの公式SVGへ差し替えた。パッケージは追加せず、必要な7種類の図形だけを`EditorIcon.tsx`へインライン化している。

- プロジェクト：[Lucide](https://lucide.dev/)
- 採用バージョン：[1.59.0](https://github.com/lucide-icons/lucide/releases/tag/1.59.0)（更新時も取得バージョンを固定する）
- 取得日：2026年10月20日
- ライセンス：[同じタグのLICENSE](https://github.com/lucide-icons/lucide/blob/1.59.0/LICENSE)
- 保持する全文：[public/licenses/lucide-LICENSE.txt](../public/licenses/lucide-LICENSE.txt)
- 公開時の配信先：`/licenses/lucide-LICENSE.txt`

## 対応

| Overlayの用途 | LucideのSVG（取得したタグへのリンク） |
|---|---|
| ペン | [pencil.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/pencil.svg) |
| マーカー | [highlighter.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/highlighter.svg) |
| 消しゴム | [eraser.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/eraser.svg) |
| テキスト | [square-dashed-text.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/square-dashed-text.svg) |
| 付箋 | [sticky-note.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/sticky-note.svg) |
| 元に戻す | [undo-2.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/undo-2.svg) |
| やり直す | [redo-2.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/redo-2.svg) |

## Overlayでの変更点

- 元SVGの図形（pathのd）・順番・24×24のviewBoxは変更しない。
- width・height属性の代わりに従来の`size-6`を使い、表示サイズは24pxを維持する。
- 線幅は元の2から、直前のUIと同じ1.75へ変更する。色は`currentColor`のまま。
- ReactのインラインSVGにし、`aria-hidden`・`focusable`を設定する。名前の読み上げ・ホバー案内は外側のボタンが担当する。
- ボタンのサイズ・選択中の灰色背景と枠・無効状態は変更しない。

## ライセンスの保持

LucideのISCライセンスの著作権表示・許諾文・免責事項を含め、同じタグのLICENSE全体を`public/licenses`へ保持する。取得元LICENSEに含まれるFeather由来アイコンのMIT表示も削らず保持する。

`public`は配信物にも含まれるため、GitHub上の資料だけに残すのではなく、公開サイトからも全文を取得できる構成にする。アイコンのコピー・改変・再配布時も、このライセンスファイルと取得元の記録を一緒に維持する。このファイルは法的な無侵害の保証をするものではない。
