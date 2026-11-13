# 編集アイコンの取得元

2026年10月20日のユーザー指示により、先に実装した線画をLucideの公式SVGへ差し替えた。2026年11月13日の図形・塗りつぶしツール追加後は15種類の図形を`EditorIcon.tsx`へインライン化している。パッケージは追加しない。

- プロジェクト：[Lucide](https://lucide.dev/)
- 採用バージョン：[1.59.0](https://github.com/lucide-icons/lucide/releases/tag/1.59.0)（更新時も取得バージョンを固定する）
- 取得日：2026年10月20日
- ページ矢印の追加取得日：2026年10月21日（同じ1.59.0の公式SVGを確認）
- ライセンス：[同じタグのLICENSE](https://github.com/lucide-icons/lucide/blob/1.59.0/LICENSE)
- 保持する全文：[public/licenses/lucide-LICENSE.txt](../public/licenses/lucide-LICENSE.txt)
- 公開時の配信先：`/licenses/lucide-LICENSE.txt`

## 対応

| Overlayの用途 | LucideのSVG（取得したタグへのリンク） |
|---|---|
| 塗りつぶし | [paint-bucket.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/paint-bucket.svg)（2026年11月13日追加） |
| 図形 | [shapes.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/shapes.svg)（2026年11月13日追加） |
| 投げ縄 | [lasso-select.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/lasso-select.svg)（2026年11月12日追加） |
| ペン | [pencil.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/pencil.svg) |
| マーカー | [highlighter.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/highlighter.svg) |
| 消しゴム | [eraser.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/eraser.svg) |
| テキスト | [square-dashed-text.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/square-dashed-text.svg) |
| 付箋 | [sticky-note.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/sticky-note.svg) |
| 元に戻す | [undo-2.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/undo-2.svg) |
| やり直す | [redo-2.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/redo-2.svg) |
| 前のページ | [chevron-left.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/chevron-left.svg) |
| 次のページ | [chevron-right.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/chevron-right.svg) |
| 移動・閲覧 | [hand.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/hand.svg) |
| スマホの設定 | [settings-2.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/settings-2.svg) |
| 書き出しメニュー | [ellipsis.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/ellipsis.svg) |

スマホ用の3種類も2026年10月21日に同じ固定タグの公式SVGを取得して確認した。設定とメニューのcircleも元図形のまま保持する。スマホではCSSで表示サイズを20pxへ縮め、操作ボタンの高さは44pxを確保する。PCの24px・線幅1.75は維持する。

## Overlayでの変更点

- 元SVGの図形（pathのd）・順番・24×24のviewBoxは変更しない。
- width・height属性の代わりに従来の`size-6`を使い、表示サイズは24pxを維持する。
- 線幅は元の2から、直前のUIと同じ1.75へ変更する。色は`currentColor`のまま。
- ReactのインラインSVGにし、`aria-hidden`・`focusable`を設定する。名前の読み上げ・ホバー案内は外側のボタンが担当する。
- ボタンのサイズ・選択中の灰色背景と枠・無効状態は変更しない。

## ライセンスの保持

LucideのISCライセンスの著作権表示・許諾文・免責事項を含め、同じタグのLICENSE全体を`public/licenses`へ保持する。取得元LICENSEに含まれるFeather由来アイコンのMIT表示も削らず保持する。

`public`は配信物にも含まれるため、GitHub上の資料だけに残すのではなく、公開サイトからも全文を取得できる構成にする。アイコンのコピー・改変・再配布時も、このライセンスファイルと取得元の記録を一緒に維持する。このファイルは法的な無侵害の保証をするものではない。
白紙追加ボタンの折り返した紙＋十字は、このプロジェクトで作成した単純なSVG図形。既存ツールと同じ24×24・線幅1.75で表示し、外部画像・絵文字は使わない。


## ノートのDrive保存状態（2026年11月5日追加）

`NotebookDriveBadge.tsx`へ、既存と同じLucide **1.59.0**の公式SVGを追加した。図形と24×24のviewBoxを保持し、一覧では16px・線幅1.75・currentColorで表示する。絵文字や外部画像の実行時読込は使わない。

| 用途 | 固定タグの取得元 |
| --- | --- |
| この端末へ取得が必要 | [cloud.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/cloud.svg) |
| 未送信あり | [cloud-upload.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/cloud-upload.svg) |
| 保存失敗・複数版・差分の要確認 | [cloud-alert.svg](https://github.com/lucide-icons/lucide/blob/1.59.0/icons/cloud-alert.svg) |

取得時に固定タグの公式ファイルと図形を確認した。ISCの著作権・許諾・免責事項と、Feather由来のMIT表示を含む既存の`public/licenses/lucide-LICENSE.txt`を引き続き配信物へ同梱する。ライセンスファイルは変更しない。マークの読み上げ・タイトル・フォーカス時の案内は外側の要素で担当する。

第6回では白紙追加の自作SVGに紙の折り返しを加え、PCでは短い「白紙追加」ラベルを添えた。タッチUIではアイコンと読み上げ名・ホバー案内を維持する。Lucide由来の図形と配布ライセンスは変更しない。

## 画像ツール（2026年11月13日追加）

画像ツールの外枠・丸・山形は、このプロジェクトで作成した単純なSVG図形。`EditorIcon.tsx`へ追加し、既存と同じ24×24・線幅1.75・currentColorを使用する。外部画像・絵文字・追加パッケージを使わない。既存15種類のLucide由来図形とライセンスは維持する。
