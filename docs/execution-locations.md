# Overlayのコードが動く場所

2026年10月20日時点の構成を説明する。機能追加の計画ではなく、現在のコードを読むための資料。

## 全体像

現在のOverlayは、PDF表示・ペン入力・自動保存・一覧・再編集・PDF出力を、主に利用者のブラウザ内で実行する。

Next.jsは画面の土台と実行に必要なファイルを用意する。Vercelはそれらを配信する。PDFや書き込みをアプリの保存APIへ送る構成ではなく、通常の保存先はブラウザ内のIndexedDBになっている。

サイトの表示にはHTML・CSS・JavaScriptなどの取得がある。「PDFの保存でサーバーを使わない」ことと「サイトが一切通信しない」ことは異なる。オフライン起動への対応も、この構成だけで保証されるものではない。

## ブラウザで動く中心部分

中心は`src/features/pdf-editor/components/PdfWorkspace.tsx`。各機能の呼び出しと編集中の状態を管理する。

以下のファイル名は、特記がなければ`src/features/pdf-editor/`からの相対パス。

| ファイル | 主な役割 |
|---|---|
| `components/PdfWorkspace.tsx` | PDF選択、ページ切り替え、描画・保存・削除・出力の取りまとめ |
| `components/PdfPage.tsx` | PDF.jsで選択中のページをcanvasへ描画 |
| `components/PenLayer.tsx` | PDFの上にSVGを重ね、色付きの線を記録する。消しゴムのプレビューと操作完了を扱う |
| `components/TextLayer.tsx`・`TextBoxEditor.tsx`・`TextSizeControl.tsx` | テキスト・付箋の設置・直接入力・文字サイズ調整、移動・削除。旧TextNoteDialogは通常画面では未使用 |
| `textData.ts`・`textLayout.ts` | テキストの検証、同じフォントを使った改行・配置の計算 |
| `noteFont.ts` | 同梱の日本語フォントを同じサイトから取得し、ブラウザの表示とPDF出力へ渡す |
| `strokeHistory.ts` | ペンとテキストの編集履歴を管理する。履歴はメモリ内だけで、保存しない |
| `eraseStrokes.ts` | 消しゴムの移動跡と線の交差を計算し、触れた部分だけを除いた線へ分割 |
| `components/NotebookSidebar.tsx` | 一覧取得、選択、作成・整理・削除、ドラッグ操作の管理 |
| `components/NotebookTree.tsx` | フォルダとノートの階層表示、開閉、操作イベントの受け渡し |
| `components/NotebookActionDialog.tsx` | 作成・名前変更・移動・削除確認のモーダル |
| `localAutosave.ts` | 保存の順番、保存中の追記、失敗時の再試行と状態通知 |
| `localNotes.ts` | 元PDF・線・テキスト・名前・所属先・フォルダの保存、読み込み、整理、削除 |
| `localDatabase.ts` | IndexedDBの接続管理とトランザクションの完了・失敗処理 |
| `exportAnnotatedPdf.ts` | pdf-libで元PDFに線とテキスト・付箋を反映し、ダウンロード用のPDFを作成 |
| `noteTree.ts`・`noteDrag.ts` | 階層の組み立てと移動先の検証 |
| `strokeData.ts`・`penStyle.ts` | 線のデータ検証とペンの設定 |

`types.ts`はデータの型を定義する。TypeScriptの型そのものは実行時には残らない。

### PDFを開いて描くときの流れ

1. `PdfWorkspace.tsx`が利用者の選んだPDFを読み取る。
2. PDF.jsでPDFを解析し、`PdfPage.tsx`がページを描画する。PDF.jsのWorkerもブラウザ内で動く。
3. `PenLayer.tsx`が描画完了時に線のデータを渡す。
4. `PdfWorkspace.tsx`がページごとの線を更新し、`localAutosave.ts`へ通知する。
5. `localNotes.ts`が`localDatabase.ts`経由でIndexedDBへ保存する。

新規PDFを選んだだけでは保存せず、最初の描画完了から初回保存を開始する。線の再保存では元PDFを重複作成しない。

### 保存場所の意味

IndexedDBはブラウザが提供するデータベース機能で、npmで追加した保存パッケージではない。

- 保存領域は端末・ブラウザのプロファイル・サイトのオリジンに依存する。
- PCで保存した内容はiPadへ自動共有されない。
- `localhost`と公開URLの保存領域も別になる。
- OS上の保存先フォルダを利用者が指定する方式ではない。
- サイトデータの削除などで内容を失う場合がある。
- 「PDFをダウンロード」は個別の閲覧・保管用出力で、線や階層を完全復元するバックアップではない。

## ブラウザ以外で動く部分

| 場所 | 主な実行場所・用途 |
|---|---|
| `src/app/page.tsx` | Next.js側でページの土台を構成する。現在の本番ビルドでは事前生成される |
| `src/app/layout.tsx` | Next.js側で共通HTML、言語、メタデータ、CSSの読み込みを設定する |
| `src/components/layout/AppHeader.tsx` | Next.js側でヘッダーの表示内容を構成する。結果のHTMLはブラウザで表示される |
| `src/app/api/health/route.ts` | サーバー側で`GET /api/health`へ応答する。PDF編集・保存には使っていない |
| `tests/` | 開発時にNode.js上で実行する。保存処理のテストには仮のIndexedDBを使う |
| `next.config.ts` | 開発・ビルド・起動時のNext.js設定 |
| `postcss.config.mjs` | ビルド時のCSS処理設定。処理後のCSSはブラウザに適用される |
| `eslint.config.mjs` | 開発時のコード検査設定 |
| `tsconfig.json` | TypeScriptの型チェック・変換などの設定 |
| `PROJECT.md`・`docs/`など | 仕様や説明の資料。アプリとして実行するコードではない |

### 「use client」の読み方

ファイル先頭の`"use client"`は、Reactの状態管理・操作イベント・ブラウザAPIを使う側への入口を示す。

ただし、「そのファイルが絶対にブラウザでしか処理されない」という意味ではない。初期表示用のHTMLはNext.js側でも生成される。IndexedDBや`window`などへのアクセスは、操作イベントや`useEffect`の中など、ブラウザで実行するタイミングに置く。

`localNotes.ts`のように`"use client"`がなくても、クライアント側から呼ばれる処理はブラウザで実行される。また、同じ関数をNode.jsのテストから呼ぶ場合もある。ファイル名やフォルダ名だけでなく、呼び出し元も確認する。

## 以前のSupabase版

以下は残してあるが、現在の通常画面では呼び出していない。

- `src/features/pdf-editor/saveNote.ts`・`loadNotes.ts`・`noteFolders.ts`：以前はブラウザからSupabaseのAPIを呼んで保存・取得していた。
- `src/lib/supabase/client.ts`：Supabaseの接続を作る。
- `supabase/migrations/`：SupabaseのPostgreSQL側で実行するSQL。ブラウザで実行するプログラムではない。

Supabaseの既存データ・コード・接続設定は削除していない。保存先の切り替えと既存データの移行は別で、移行機能は未実装。

## ダウンロードされたもの・自動生成されたものとの違い

- `node_modules/`：npmで取得したパッケージ本体。実行場所はパッケージや利用方法によって異なる。必要なReact・PDF.jsなどのコードはブラウザ用の配信ファイルにも含まれるが、開発用ツールを含めた全体がブラウザで実行されるわけではない。
- `.next/`：Next.jsが生成した実行・配信用の出力。ブラウザ用とサーバー用が含まれ、直接編集しない。
- `package.json`：使用するパッケージと実行コマンドの定義。
- `package-lock.json`：npmが管理する正確な依存関係・バージョンの記録。
- `src/`：初期ひな型を含みつつ、Overlayの動作を実装している場所。

処理を追うときは、まず`PdfWorkspace.tsx`を読み、表示は`PdfPage.tsx`と`PenLayer.tsx`、保存は`localAutosave.ts`と`localNotes.ts`、一覧は`NotebookSidebar.tsx`へ進むと整理しやすい。
