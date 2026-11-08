# PDF.js 配信資産

インストール済み`pdfjs-dist` 6.3.289の同名ディレクトリをコピーした配信用アセットです。`PdfWorkspace.tsx`の読み込み設定で同一サイトのURLを指定し、必要なファイルだけ取得します。

| 配信先 | 用途 | ライセンス |
| --- | --- | --- |
| `cmaps/` | 日本語・中国語・韓国語等のPDFが参照する圧縮文字対応表。`cMapUrl: "/pdfjs/cmaps/"`と`cMapPacked: true`を指定 | Adobe、BSD 3-Clause。[全文](cmaps/LICENSE) |
| `standard_fonts/` | 非埋め込み標準フォント。`standardFontDataUrl: "/pdfjs/standard_fonts/"`を指定 | [Foxit](standard_fonts/LICENSE_FOXIT)・[Liberation](standard_fonts/LICENSE_LIBERATION) |

取得元はnpmパッケージ`pdfjs-dist`の`cmaps/`と`standard_fonts/`です。PDF.js更新時には対応するパッケージから一式を更新し、ライセンスを保持してください。CMapは`tests/pdf-cmaps.test.ts`でインストール済み資産との一致を検証します。日本語メモの出力用フォント（`public/fonts/`）とは別です。

[PDF.jsの読み込みオプション](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)
