# Overlay

PDFをWebブラウザ上で表示し、その上に書き込みを重ねてノートとして扱うWebアプリケーションです。

第1回のMVPを公開済みです。現在は第2回として、元PDFと書き込み情報をSupabaseへ分けて保存する機能を開発しています。ペンの太さと表示倍率も調整できます。

## 開発環境

```bash
npm install
npm run dev
```

ブラウザで <http://localhost:3000> を開きます。

Supabase保存機能を利用する場合は、[保存先の設定手順](./docs/supabase-setup.md)に従ってください。接続先の環境変数は`.env.local`に置き、このファイルをGitへ追加しません。

## 主なコマンド

```bash
npm run dev
npm run lint
npm run build
npm start
```

## ディレクトリ構成

```text
src/
├── app/                  # 画面ルートとRoute Handlers
│   └── api/              # バックエンドのHTTP窓口
├── components/           # 複数機能で共有するUI
├── features/             # 機能単位のフロントエンド実装
├── lib/                  # 共通処理（必要になった時点で追加）
├── server/               # サーバー専用処理（必要になった時点で追加）
└── types/                # 共通の型（必要になった時点で追加）
```

詳細な仕様は[PROJECT.md](./PROJECT.md)を参照してください。

## ペン書き込みの処理

1. `PdfPage.tsx`がPDF.jsで選択中のページをcanvasに描画する。
2. 描画が終わると`PenLayer.tsx`が透明なSVGをPDFの上に重ねる。マウスやタッチの動きをPointer Eventsで受け取り、点の列として記録する。
3. 点の座標はページ幅・高さに対する0～1の割合に変換する。PDFの表示サイズが変わっても、線が同じ位置に重なる。
4. `PdfWorkspace.tsx`が線をページ番号ごとにReactの状態へ保持する。ページを切り替えて戻ると線を再表示し、別のPDFを選んだときは状態を初期化する。

線のデータ構造は`src/features/pdf-editor/types.ts`に定義している。座標は0～1の割合、太さはPDF上の線幅として保持する。`PdfPage.tsx`と`PenLayer.tsx`が表示倍率に応じてPDFと線を拡大・縮小する。

## 第2回の保存処理

1. `PdfWorkspace.tsx`の「ノートを保存」から`saveNote.ts`を呼び出す。
2. `src/lib/supabase/client.ts`が環境変数でSupabaseへ接続する。初回の保存時に匿名の識別情報を作り、同じブラウザで保持する。
3. 元PDFを非公開の`overlay-pdfs`バケットへ、ページごとの線データとPDFの保存場所を`notes`テーブルへ保存する。
4. 同じPDFを開いたまま再度保存すると、同じノートの線データを更新する。PDFを重複してアップロードしない。

保存処理はブラウザからSupabaseのAPIを利用する。アクセス制限はSQLのRLS（行単位のアクセス制御）で行い、保存したブラウザの識別情報に対応するデータだけを許可する。独自のサーバー専用処理は現段階では必要ないため追加していない。

未保存の線は再読み込みすると消える。保存済みのデータはSupabaseに残るが、一覧から開く・編集を再開する画面は第3回の対象であり、現段階では実装しない。
