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
