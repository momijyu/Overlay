# PDF.js 標準フォント

`standard_fonts/`は、インストール済みの`pdfjs-dist` 6.3.289の同名ディレクトリをコピーした配信用アセットです。`PdfWorkspace.tsx`が`standardFontDataUrl: "/pdfjs/standard_fonts/"`を指定し、必要なフォントだけを同じサイトから取得します。

取得元はnpmパッケージ`pdfjs-dist`の`standard_fonts/`です。同梱の`LICENSE_FOXIT`と`LICENSE_LIBERATION`を保持しています。PDF.js更新時には対応するパッケージから更新してください。日本語メモの出力用フォント（`public/fonts/`）とは別です。
