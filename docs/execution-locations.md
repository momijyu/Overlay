# Overlayのコードが動く場所

2026年11月6日時点。現在の処理の役割をまとめる。利用者向け操作は[README](../README.md)、正式仕様は[PROJECT.md](../PROJECT.md)。

## 全体像

Next.jsとVercelが画面・JavaScript・CSS・Worker・フォントを配信する。PDFの解析・編集・IndexedDB保存・バックアップ・Google認可・Drive API呼び出しはブラウザ側で行う。OverlayのサーバーへPDFをアップロードする構成ではない。

Google未連携時は端末内だけにノートを保存する。連携後は本人のDriveへPDFと編集情報を送り、端末には一覧・キャッシュ・未送信の編集を保持する。アプリの取得やフォントの遅延取得もあるため「保存先が端末内」と「一切通信しない」「オフラインで起動できる」は別。

## ブラウザ側の中心

以下はsrc/features/pdf-editorからの相対パス。

| ファイル | 役割 |
| --- | --- |
| components/PdfWorkspace.tsx | PDF選択・編集状態・ページ・保存・切り替え・書き出しの取りまとめ |
| components/PdfPage.tsx / PenLayer.tsx | PDF.jsでページ描画、透明SVG上のペン／消しゴム操作 |
| components/TextLayer.tsx / TextBoxEditor.tsx | テキスト・付箋の直接入力、色・サイズ・移動・確定 |
| strokeData.ts / textData.ts / textLayout.ts / notePages.ts | 保存データ検証、文字配置、固定IDと白紙の構成 |
| strokeHistory.ts / eraseStrokes.ts | メモリ内のUndo / Redo、部分消去 |
| localAutosave.ts / localNotes.ts / localDatabase.ts | 端末保存の順序・更新番号・失敗・IndexedDBトランザクション |
| localNoteSummary.ts / stickyOutline.ts | PDF本文を読まない一覧情報と付箋の参照 |
| components/NotebookDrawer.tsx / NotebookSidebar.tsx / NotebookTree.tsx | 一覧の開閉・階層表示・整理・選択・ドラッグ |
| noteTree.ts / noteDrag.ts / noteSelection.ts / notebookTouchDrag.ts | 階層・一括操作の検証と長押し操作 |
| noteBackupData.ts / noteBackupFile.ts | 編集用ZIPの検証・梱包・解析 |
| exportAnnotatedPdf.ts / noteFont.ts | 同梱フォントの遅延取得、日本語・線・白紙を反映したPDF出力 |
| googleIdentity.ts / googleDriveAuth.ts / googleDriveSession.ts | SDK準備・認可・接続先をメモリで保持 |
| googleDriveClient.ts / googleDriveNotes.ts / googleDriveBatch.ts | 制限付きDrive HTTP・取得・手動保存と一括進行 |
| driveLibraryData.ts / driveLibraryLocal.ts / driveLibraryRemote.ts | 固定ID階層の履歴・競合・一覧・Drive上の移動 |
| driveLibraryRuntime.ts / driveAutosave.ts / driveOutbox.ts | 階層と本文の送信順・再試行・未送信保護 |
| driveLibraryCache.ts / driveCacheChecks.ts / driveCacheSettings.ts | 必要時取得・背景更新確認・キャッシュ整理と上限 |

PDFを開き、最初の確定編集でlocalAutosaveへ通知し、localNotesがPDF・編集情報・一覧を同じトランザクションで保存する。Drive連携中は送信待ちも記録し、画面が動いている間に別のrunnerが送信する。DBトランザクション内でGoogle通信を待たない。

IndexedDBはブラウザ提供のAPIで、保存領域は端末・ブラウザ・originごとに分かれる。現在のDB版は7。DBを消して移行する必要はない。Driveの形式・保護条件は[保存設計](drive-storage.md)、バックアップは[ファイル仕様](note-backups.md)を参照する。

## Next.js・開発時の処理

| 場所 | 役割 |
| --- | --- |
| src/app/page.tsx / layout.tsx | ページの土台、共通HTML・言語・メタデータ |
| src/components/layout/AppHeader.tsx | 親から渡された操作を含むヘッダー表示 |
| src/app/api/health/route.ts | GET /api/health。PDFの保存窓口ではない |
| tests/ | Node.js上の仮IndexedDB・仮API・React操作テスト |
| next.config.ts / postcss.config.mjs | 開発・ビルド・配信とCSSの設定 |
| tsconfig.json / eslint.config.mjs | TypeScriptと静的検査の設定 |
| PROJECT.md / docs/ | 仕様と説明。アプリとして実行するコードではない |

use clientは状態・イベント・ブラウザAPIを使う側への入口。初期HTMLはNext.js側でも生成されるため、window・IndexedDB等は操作やeffectなどブラウザで実行されるタイミングに置く。指示がないモジュールも、クライアントからimportされればブラウザ側へ含まれる。ファイル名だけでなく呼び出し元を見る。

## 自作コードと取得物

- src/：初期ひな型とOverlay用の実装。
- node_modules/：npmが取得した依存本体。ブラウザ用と開発・サーバー用があり、すべてをブラウザで動かすわけではない。直接編集しない。
- .next/：Next.jsの生成物。ブラウザ用・サーバー用を含む。直接編集しない。
- public/：配信するフォント・PDF.js用資産とライセンス。第三者資産を含むため、不要コードの整理でライセンスを除去しない。
- package.json / package-lock.json：利用パッケージ・コマンドと正確な依存関係。

旧Supabaseコード・SQL・SDKは第6回でリポジトリから削除した。現在の処理を読む際に追う必要はない。方針変更は[開発経緯](development-history.md)、削除前の実装はGit履歴で参照できる。実クラウドのデータは変更していない。
