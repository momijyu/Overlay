# Google Drive連携の設定

ローカル保存だけなら設定不要。Drive連携を使う開発者はGoogle CloudでOAuthクライアントIDを作成する。利用者はノート一覧の「Google Drive」欄の「接続設定」から自分のGoogleアカウントで接続する。接続先の確認後、選択中の保存先の全ローカルノート・フォルダが自動保存対象になる。[保存・容量・競合の仕様](drive-storage.md)

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
4. 未作成の場合、作成するなら「専用フォルダを作成」を押す。本人のDriveのルートに`Overlay`を作る。確認後は自動連携が始まり、選択中の保存先のローカルノート・フォルダも送信対象になる。
5. 「閉じる」で進行中の操作・通信を中断する。有効な認可と確認済みアカウントは同じページのメモリで再利用し、次に開くときの認証を省く。ページ再読み込み・期限切れ・失効後は再接続する。DB等へトークンを保存せず、Google側の権限取消・フォルダ削除は行わない。

別のアカウントを選ぶと、切り替えの確認画面を表示する。確定時は編集中の内容をローカルへ保存した後に画面を再読み込みするので、切り替え先へもう一度接続する。ノート・PDF・フォルダ・未送信データをアカウント別に保持し、元の内容は自動コピーしない。元のアカウントを選び直すと元の保存先へ戻る。キャンセル・保存失敗時は切り替えない。既に開いている別タブの保存先も変えない。同じアカウントで連携済みのOverlayフォルダが見つからない場合は、従来どおり停止して元の保存先の確認を求める。

専用の`appProperties`でOverlayが作成したフォルダを識別する。同名の一般フォルダを流用しない。改名した専用フォルダは目印で見つけ、複数見つかった場合は自動選択・統合・削除を行わず停止する。作成中の通信断は結果不明として再検索を案内する。検索直後の同時作成を完全には防げないため、作成後も重複を確認する。[アプリ専用プロパティ](https://developers.google.com/workspace/drive/api/guides/properties)、[フォルダ作成](https://developers.google.com/workspace/drive/api/guides/folder)に基づく。

本人情報はDrive APIの[about.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get)から取得する。失効・権限エラー・通信断では再接続または再確認を案内する。認可成功だけを「Driveへノート保存済み」と表示しない。11月15日時点で通常のDrive同期・保存・書き出しとスマホ・iPadの使用感は利用者確認報告がある。テストユーザー以外のGoogle接続と異常時の実機確認は別に残す。Google側のエラーでは次を確認する。

- 「承認されたテスターのみ」：Google Auth Platformの「対象 → テストユーザー」へ、ログインに使うアカウントを追加する。連絡先メールの登録とは別。
- ログイン後にDrive APIのアクセスエラー：「APIとサービス → ライブラリ → Google Drive API」が有効か確認する。OAuthクライアントの作成とは別の設定。
- パスキーの本人確認から進まない：Google画面の「別の方法を試す」などで本人確認を完了する。エディタ内ブラウザで止まる場合は、通常のChromeでOverlayのlocalhost:3000から接続を始め直す。

## 認証処理の範囲と残作業

`googleIdentity.ts`は明示的な準備操作でだけ公式SDKを読み込み、同時読み込みの共有・失敗・時間切れ・再試行を扱う。`googleDriveAuth.ts`は準備後のクリックから同期的に認証要求を開始する。トークンはインスタンスのメモリだけに保持し、DB・localStorage・URL・公開状態・エラーメッセージへ保存しない。画面の再読み込み後に自動復元しない。`drive.file`のみ要求し、権限不足・認証拒否・ポップアップの閉鎖やブロック・期限切れを扱う。

期限切れ時にはユーザー操作で再接続する。[Google公式説明](https://developers.google.com/identity/oauth2/web/guides/use-token-model)。トークンは有効期限の最大30秒前から使用を止め、API側で失効が分かった場合にも破棄できる。認証操作が2分応答しなければ失敗として再試行できるようにする。再接続開始時に古いトークンを捨て、切断・時間切れ後に遅れて届く古い応答は採用しない。`disconnect()`はメモリの認可情報を捨てる操作であり、Google側の全権限取消やノート削除ではない。

認可成功・専用フォルダ確認と、ノートのDrive送信完了は別。ノート一覧の「Drive自動保存」に未送信・停止状態を表示し、期限切れは同じアカウントへ再接続する。未送信内容を別アカウントへ送らない。詳細は[Drive設計](drive-storage.md)。

## 6. Google連携を一般利用者へ公開する手順（未完了）

Vercelへのサイト配備と、Googleが接続を許可する利用者の範囲は別の設定。現在のGoogle Cloudの公開状態は未確認であり、接続できたテストユーザーの結果だけで一般公開済みとは扱わない。実際の設定変更は、以下のページ内容を利用者が確認し、公開URLへ配備してから行う。

### 先にページを確認・配備する

- `/about`に機能・使い始め方・保存先・書き出し・問い合わせ先をまとめ、既存の操作ガイドを開けるようにした。`/terms`には利用条件の文案、`/privacy`には保存内容・利用目的・外部サービス・保管期間・削除方法・Googleの許可取消を記載。3ページは認証不要で相互に移動でき、編集画面は`/`に維持する。
- ノート一覧の下部から3ページを別タブで開く。Google接続画面にはプライバシーポリシーへの直接リンクを維持する。
- 問い合わせ先は利用者指定の専用Gmail [momijyu.t0204@gmail.com](mailto:momijyu.t0204@gmail.com)を3ページへ掲載した。ページ内容・開発者表記を利用者が確認する。Googleに登録するサポートメール／開発者連絡先は別に必要であり、利用者が管理できるアドレスをGoogle Cloud上で指定する。
- 承認後にcommit・push・デプロイする。ログインしていない状態でホームページからプライバシーページへ進めること、直接URLでも全文が表示されることを確認する。

### Google Cloudに登録する

対象プロジェクトを選び、「Google Auth Platform」を開く。

| 場所・項目 | 登録・確認する内容 |
| --- | --- |
| Branding → アプリ名 | `Overlay` |
| Branding → ユーザーサポートメール／開発者連絡先 | 利用者が受信・管理できるメールアドレス |
| Branding → アプリのホームページ | `https://overlay-virid.vercel.app/about` |
| Branding → プライバシーポリシー | `https://overlay-virid.vercel.app/privacy` |
| Branding → 利用規約（任意項目） | 文案を確認・配備後、`https://overlay-virid.vercel.app/terms` |
| Branding → 承認済みドメイン | 実際のホームページ・ポリシー・OAuth originに対応するドメイン。Googleの案内に従い所有権を確認する |
| Data Access → スコープ | `https://www.googleapis.com/auth/drive.file`。広いDrive権限は追加しない |
| Clients → Authorized JavaScript origins | `https://overlay-virid.vercel.app`。開発用originは第3節のまま維持 |
| Audience → User type | 一般のGoogleアカウントで使う場合はExternal |
| Audience → Publishing status | ページ・権限・接続先を確認後、「Publish app／アプリを公開」でIn productionへ変更 |

ホームページとポリシーは認証なしで閲覧できる必要がある。所有権確認を求められた場合は、Google Search Console等の画面の案内で進める。現在の配備ドメインで確認できない場合はそこで条件を確認し、架空のドメインや所有していないドメインは登録しない。[Googleのブランド・ドメイン確認要件](https://developers.google.com/identity/verification/authentication-verification)

`drive.file`はGoogleが非機密（non-sensitive）に分類している権限。ただし、スコープ審査と、アプリ名・ロゴ・ドメイン等のブランド確認は別。Consoleに表示される確認・審査の要否に従い、「審査は不要」と一律に判断しない。Brandingを変更した場合は下書きのまま残っていないか確認し、必要な検証と「Publish branding」も完了する。[スコープの分類](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[ブランド確認](https://developers.google.com/identity/verification/authentication-verification)

AudienceをIn productionにすると、テストユーザー一覧にないGoogleアカウントも接続対象になる。ただし学校・組織アカウントの管理者制限等は別であり、全アカウントでの接続を保証しない。公開状態を変えても、Overlayのトークンは引き続きメモリ内のみで、期限切れ・ページ再読み込み後の再接続は必要。[GoogleのAudienceと公開状態](https://support.google.com/cloud/answer/15549945?hl=en)

### 公開後の確認

- VercelのProduction環境に`NEXT_PUBLIC_GOOGLE_CLIENT_ID`をConfigとして登録し、再ビルドした版で確認する。AI Gateway API Keyやクライアントシークレットは使用しない。
- テストユーザーに登録していない、使用許可を得たアカウントで公開URLから接続する。既存のブラウザデータは消さず、別プロファイル等と自作の確認用PDFを使う。
- アプリ名・要求権限・ポリシーリンク、本人のDriveへの保存と再読み込みを確認する。Google Cloud側の状態・表示される警告も記録する。
- 通常のスマホ・iPad利用の成功報告とは分けて、認可失効・再接続・未送信保護・競合時の実確認を残す。

実際のGoogle Cloud設定変更・審査申請・デプロイは、この実装では行っていない。独自コードのライセンスは利用者指定で保留を維持する。過去にクライアントシークレットを共有した場合はGoogle Cloud側で再発行し、古いものを無効化する。今回のアプリでシークレットを使う必要はない。
