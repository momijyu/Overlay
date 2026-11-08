# Google Drive連携の設定

ローカル保存だけなら設定不要。Drive連携を使う開発者はGoogle CloudでOAuthクライアントIDを作成する。利用者はノート一覧の「Google Drive」欄の「接続設定」から自分のGoogleアカウントで接続する。接続先の確認後、このブラウザの全ローカルノート・フォルダが自動保存対象になる。[保存・容量・競合の仕様](drive-storage.md)

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

今回はGIS token modelのポップアップを使うため、「Authorized redirect URIs」へのコールバックURLの追加は不要。架空のコールバックURLを入れない。クライアントIDの作成手順は[Google公式Setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)を参照。

作成後、末尾が`.apps.googleusercontent.com`のクライアントIDだけを控える。これはブラウザで使用するアプリ識別子。クライアントシークレット、アクセストークン、Googleパスワード、認証情報JSONはチャット・Git・`NEXT_PUBLIC_`変数へ入れない。

## 4. アプリ側の設定

作成したクライアントIDを、ルートの`.env.local`へ追加する。Supabaseの設定は使用しない。

```dotenv
NEXT_PUBLIC_GOOGLE_CLIENT_ID=作成したクライアントID.apps.googleusercontent.com
```

上は書式の見本。実際のクライアントID全体をそのまま貼り、末尾を二重に付けない。`.env.example`には空欄の項目だけを追加した。`.env.local`はGitへ追加しない。環境変数を変更したら開発サーバーを自分で再起動する。同じlocalhost:3000を使い続け、サイトデータは削除しない。

Vercelでは同じ名前の環境変数を対象の環境へ設定し、再デプロイする。公開変数はビルド時に組み込まれる。OAuth画面へ登録したoriginと実際に開くURLを一致させる。接続確認の入口は未設定でも表示するが、IDが未設定・不正な場合は準備時にエラーを表示する。

## 5. 接続確認の操作

1. 左上の三本線からノート一覧を開き、「Google Drive」欄の「接続設定」を押す。この時だけGoogle SDKの準備を始める。
2. 準備完了後に「Googleで接続」を押し、Googleの画面でテストユーザーのアカウントを選んで許可する。
3. メールアドレスとOverlay専用フォルダの有無を確認する。氏名は表示しない。アカウントが違う場合は「アカウントを選び直す」。
4. 未作成の場合、作成するなら「専用フォルダを作成」を押す。本人のDriveのルートに`Overlay`を作る。確認後は自動連携が始まり、既存のローカルノート・フォルダも送信対象になる。
5. 「閉じる」で進行中の操作・通信を中断する。有効な認可と確認済みアカウントは同じページのメモリで再利用し、次に開くときの認証を省く。ページ再読み込み・期限切れ・失効後は再接続する。DB等へトークンを保存せず、Google側の権限取消・フォルダ削除は行わない。

専用の`appProperties`でOverlayが作成したフォルダを識別する。同名の一般フォルダを流用しない。改名した専用フォルダは目印で見つけ、複数見つかった場合は自動選択・統合・削除を行わず停止する。作成中の通信断は結果不明として再検索を案内する。検索直後の同時作成を完全には防げないため、作成後も重複を確認する。[アプリ専用プロパティ](https://developers.google.com/workspace/drive/api/guides/properties)、[フォルダ作成](https://developers.google.com/workspace/drive/api/guides/folder)に基づく。

本人情報はDrive APIの[about.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get)から取得する。失効・権限エラー・通信断では再接続または再確認を案内する。認可成功だけを「Driveへノート保存済み」と表示しない。この確認画面はユーザーがChromeのlocalhost:3000で本人・専用フォルダの表示成功を確認した。iPad・公開環境は未確認。Google側のエラーでは次を確認する。

- 「承認されたテスターのみ」：Google Auth Platformの「対象 → テストユーザー」へ、ログインに使うアカウントを追加する。連絡先メールの登録とは別。
- ログイン後にDrive APIのアクセスエラー：「APIとサービス → ライブラリ → Google Drive API」が有効か確認する。OAuthクライアントの作成とは別の設定。
- パスキーの本人確認から進まない：Google画面の「別の方法を試す」などで本人確認を完了する。エディタ内ブラウザで止まる場合は、通常のChromeでOverlayのlocalhost:3000から接続を始め直す。

## 認証処理の範囲と残作業

`googleIdentity.ts`は明示的な準備操作でだけ公式SDKを読み込み、同時読み込みの共有・失敗・時間切れ・再試行を扱う。`googleDriveAuth.ts`は準備後のクリックから同期的に認証要求を開始する。トークンはインスタンスのメモリだけに保持し、DB・localStorage・URL・公開状態・エラーメッセージへ保存しない。画面の再読み込み後に自動復元しない。`drive.file`のみ要求し、権限不足・認証拒否・ポップアップの閉鎖やブロック・期限切れを扱う。

期限切れ時にはユーザー操作で再接続する。[Google公式説明](https://developers.google.com/identity/oauth2/web/guides/use-token-model)。トークンは有効期限の最大30秒前から使用を止め、API側で失効が分かった場合にも破棄できる。認証操作が2分応答しなければ失敗として再試行できるようにする。再接続開始時に古いトークンを捨て、切断・時間切れ後に遅れて届く古い応答は採用しない。`disconnect()`はメモリの認可情報を捨てる操作であり、Google側の全権限取消やノート削除ではない。

認可成功・専用フォルダ確認と、ノートのDrive送信完了は別。ノート一覧の「Drive自動保存」に未送信・停止状態を表示し、期限切れは同じアカウントへ再接続する。未送信内容を別アカウントへ送らない。詳細は[Drive設計](drive-storage.md)。

## 公開前の確認（未完了）

- 実際の公開URLとAuthorized JavaScript origins、Vercelの対象環境のクライアントIDを一致させ、再ビルドされた版で確認する。VercelのAI Gateway API Keyは使用しない。公開IDはConfigとして登録する。
- Google Auth PlatformのAudience・公開状態と、利用できるアカウントの範囲を確認する。テストユーザーの成功だけで一般利用可能と判断しない。
- Branding・必要なドメイン確認・プライバシー説明・連絡先と、要求権限の説明を用意する。独自コードのライセンスと公開素材は利用者と確認する。
- Chrome・スマホ・iPadから接続し、通常保存・再接続・未送信保護を公開URLで確認する。

実際のGoogle Cloud設定変更・デプロイは、この資料の整理だけでは実施しない。アプリのクライアントIDとシークレットは別。シークレットを公開変数へ設定しない。過去にシークレットを共有した場合はGoogle Cloud側で再発行し、古いものを無効化する。
