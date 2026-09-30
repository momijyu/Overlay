# Overlay

PDFをWebブラウザ上で表示し、その上に書き込みを重ねてノートとして扱うWebアプリケーションです。

現在は第1回のMVP開発段階です。PDFのアップロード、表示、ペン書き込み、Vercelへの公開を最初のゴールとします。

## 開発環境

```bash
npm install
npm run dev
```

ブラウザで <http://localhost:3000> を開きます。

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

線のデータ構造は`src/features/pdf-editor/types.ts`に定義している。現在の線はブラウザのメモリ内だけにあり、ページを再読み込みすると消える。永続保存は第2回の開発で追加する。
