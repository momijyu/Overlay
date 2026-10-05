# Supabase保存機能の設定

第2回では、元PDFとペンの書き込み情報を分けて保存する。一覧からノートを開く機能は第3回で実装する。

第2回で使う認証は、ユーザー確認済みの匿名認証だけとする。サインイン画面と個人アカウント管理は第6回の対象であり、今回は追加しない。

## 1. 匿名サインインを有効にする

Supabaseのプロジェクト画面で、Authenticationの「Sign In / Providers」を開き、「Allow anonymous sign-ins」を有効にして保存する。設定の説明は[公式のGeneral configuration](https://supabase.com/docs/guides/auth/general-configuration)を参照する。

これはメールアドレスやパスワードを入力する画面を追加せず、保存したブラウザを識別するための設定。同じブラウザ・同じサイトで識別情報が保持される。ブラウザのサイトデータを削除した場合、プライベートブラウズを終了した場合、別のブラウザ・端末・サイトURLを使った場合は、同じ識別情報を利用できない。

詳細は[Supabaseの匿名サインイン](https://supabase.com/docs/guides/auth/auth-anonymous)を参照する。

## 2. 保存先とアクセス制限を作成する

SupabaseのSQL Editorで新規クエリを開き、[202610050001_notes.sql](../supabase/migrations/202610050001_notes.sql)の内容を貼り付けて、1回だけ実行する。

このSQLは次のものを作成する。

- `notes`テーブル: ファイル名、元PDFの保存場所、ページごとの線データ、保存日時を記録する。
- `overlay-pdfs`バケット: 元PDFを非公開で保存する。
- RLS: ノートとPDFへのアクセスを、保存した識別情報の所有者だけに制限する。

SQL全体をトランザクションで実行するため、途中でエラーになった場合は作成途中の変更が残らない。成功後に同じSQLを再実行すると、作成済みのテーブルなどと重複してエラーになる。

## 3. ローカルの接続先を設定する

プロジェクト直下の`.env.local`に次の環境変数を設定する。値はSupabaseのConnect画面で取得する。今回のローカル環境には設定済み。

```dotenv
NEXT_PUBLIC_SUPABASE_URL=プロジェクトURL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=公開用キー
```

公開用キーはブラウザからSupabaseのAPIへ接続するために使う。データの保護は、キーを隠すことではなくRLSのアクセス制限で行う。`secret`や`service_role`のキーはここに設定しない。

`.env.local`は`.gitignore`で除外されている。環境変数を追加・変更したら、開発サーバーを再起動する。

## 4. 保存を確認する

1. `npm run dev`で起動し、PDFを読み込んで線を描く。
2. 「ノートを保存」を押し、「保存済み」が表示されることを確認する。
3. SupabaseのTable Editorで`notes`に1件のデータがあり、`file_name`、`pdf_path`、`strokes_by_page`が入っていることを確認する。
4. Storageの`overlay-pdfs`に、ユーザーIDのフォルダと元PDFがあることを確認する。保存されたPDFに線が焼き込まれていないことも確認する。
5. 画面を開いたまま線を追加し、「未保存の変更があります」の表示後に再度保存する。
6. `notes`の同じ行で`strokes_by_page`と`updated_at`が更新され、PDFが重複して増えていないことを確認する。

保存中に線を追加した場合、その線は次の保存の対象になる。最初の保存処理が完了しても「未保存の変更があります」と表示する。

保存したノートをアプリから選び直す機能はまだない。今回はSupabaseの管理画面で保存結果を確認する。

表示倍率は50～200%で切り替えられる。100%は画面に収まる初期表示の大きさを基準にする。線を描いてから倍率を変え、PDFと線の位置が重なること、拡大時に横スクロールできること、別のページへ移動して戻っても線が残ることを確認する。倍率を変えるだけでは保存データは変わらない。

## 5. Vercelの接続先を設定する

VercelのOverlayプロジェクトのEnvironment Variablesに、`.env.local`と同じ2つの環境変数を設定する。Productionで保存する場合はProductionを対象にする。

`NEXT_PUBLIC_`の値はビルド時にブラウザ用コードへ組み込まれるため、設定したあとに新しいデプロイを行う必要がある。commit・pushはユーザーが行う。

ローカルと公開環境はサイトURLが異なるため、匿名の識別情報も別になる。公開環境では`https://overlay-virid.vercel.app/`を継続して使う。
