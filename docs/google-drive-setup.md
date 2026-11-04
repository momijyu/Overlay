# Google Drive連携の事前設定

2026年11月4日、利用者の確認でブラウザ完結のGoogle Identity Services（GIS）token modelを採用した。認証の内部処理とテストは追加したが、通常画面・Drive保存との接続はまだ行っていない。いま準備するのはGoogle CloudプロジェクトとWebアプリ用のOAuthクライアントID。作成しただけではOverlayの保存先は変わらず、既存データも送信されない。

## 1. プロジェクトとDrive API

1. [Google Cloud Console](https://console.cloud.google.com/)で、Overlay用のプロジェクトを作成または選択する。
2. 「APIとサービス → ライブラリ」で「Google Drive API」を検索し、有効にする。

このプロジェクトはアプリの設定用。利用者のPDFを運営者のDriveへ集める設定ではない。手順の根拠は[Drive公式クイックスタート](https://developers.google.com/workspace/drive/api/quickstart/js)。サンプルコードのAPIキー・広い権限はそのままコピーしない。

## 2. 同意画面

「Google Auth Platform」の設定を開始する。

- Branding：アプリ名を`Overlay`とし、連絡用メールアドレスを設定する。
- Audience：個人Googleアカウントや組織外で使う場合はExternalを選ぶ。開発中はTestingとして、自分が動作確認に使うGoogleアカウントをテストユーザーへ追加する。
- Data Access：Drive用には`https://www.googleapis.com/auth/drive.file`を使う方針。アプリが作成したファイルや、利用者がアプリに許可したファイルを対象とする。Drive全体の読み書き権限`.../auth/drive`や全体読み取り`.../auth/drive.readonly`は追加しない。

公開配布時には、同意画面・ドメイン・プライバシーポリシー等の要件を別途確認する。テストユーザー設定だけで一般公開の準備完了とは扱わない。権限の根拠は[Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)。

## 3. OAuthクライアントID

「Clients → Create client」から、Application typeを「Web application」にする。名前は`Overlay Web`など管理用の名前でよい。

「Authorized JavaScript origins」へ以下を登録する。パスや末尾の`/`は付けない。

```text
http://localhost
http://localhost:3000
https://overlay-virid.vercel.app
```

別ポートや別の公開URLを実際に使う場合だけ、そのoriginも追加する。開発サーバーのポートはこの作業で変更しない。

今回はGIS token modelのポップアップを使うため、「Authorized redirect URIs」へのコールバックURLの追加は不要。架空のURLやSupabase用のコールバックを入れない。クライアントIDの作成手順は[Google公式Setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)を参照。

作成後、末尾が`.apps.googleusercontent.com`のクライアントIDだけを控える。これはブラウザで使用するアプリ識別子。クライアントシークレット、アクセストークン、Googleパスワード、認証情報JSONはチャット・Git・`NEXT_PUBLIC_`変数へ入れない。

## 4. アプリ側の設定

作成したクライアントIDを、ルートの`.env.local`へ追加する。既存のSupabase用設定を削除する必要はない。

```dotenv
NEXT_PUBLIC_GOOGLE_CLIENT_ID=作成したクライアントID.apps.googleusercontent.com
```

上は書式の見本。実際のクライアントID全体をそのまま貼り、末尾を二重に付けない。`.env.example`には空欄の項目だけを追加した。`.env.local`はGitへ追加しない。環境変数を変更したら開発サーバーを自分で再起動する。同じlocalhost:3000を使い続け、サイトデータは削除しない。

Vercelでは同じ名前の環境変数を対象の環境へ設定し、再デプロイする。公開変数はビルド時に組み込まれる。OAuth画面へ登録したoriginと実際に開くURLを一致させる。設定しても、通常UIとの接続が未実装の現段階では接続ボタンは現れない。

## 認証処理の範囲と残作業

`googleIdentity.ts`は明示的な準備操作でだけ公式SDKを読み込み、同時読み込みの共有・失敗・時間切れ・再試行を扱う。`googleDriveAuth.ts`は準備後のクリックから同期的に認証要求を開始する。トークンはインスタンスのメモリだけに保持し、DB・localStorage・URL・公開状態・エラーメッセージへ保存しない。画面の再読み込み後に自動復元しない。`drive.file`のみ要求し、権限不足・認証拒否・ポップアップの閉鎖やブロック・期限切れを扱う。

期限切れ時にはユーザー操作で再接続する。[Google公式説明](https://developers.google.com/identity/oauth2/web/guides/use-token-model)。トークンは有効期限の最大30秒前から使用を止め、API側で失効が分かった場合にも破棄できる。認証操作が2分応答しなければ失敗として再試行できるようにする。再接続開始時に古いトークンを捨て、切断・時間切れ後に遅れて届く古い応答は採用しない。`disconnect()`はメモリの認可情報を捨てる操作であり、Google側の全権限取消やノート削除ではない。

`authorized`はGoogle APIの認可成功であって、「Driveへ保存済み」「このアカウントの同期準備完了」ではない。アカウント識別・未送信データとの照合・Drive保存・キャッシュ整理・通常UIとの接続は後続で実装する。認証だけ成功した状態で保存先を切り替えたり、未送信データを別アカウントへ送ったりしない。実際のGoogle画面・iPadのポップアップ・公開環境の動作確認はまだ行っていない。
