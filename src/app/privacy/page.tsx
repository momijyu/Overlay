import type { Metadata } from "next";
import Link from "next/link";
import { SiteInfoLinks } from "@/components/layout/SiteInfoLinks";

const title = "プライバシーポリシー | Overlay";
const description = "Overlayの端末内保存、Google Drive連携、データの利用と削除について。";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, url: "/privacy" },
  twitter: { title, description },
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-8 text-base-content sm:px-8 sm:py-12">
      <Link href="/" prefetch={false} className="link link-hover text-sm">Overlayを開く</Link>
      <header className="mt-6 border-b border-base-300 pb-6">
        <h1 className="text-2xl font-bold">プライバシーポリシー</h1>
        <p className="mt-2 text-sm text-base-content/70">更新日：2026年11月16日</p>
      </header>
      <div className="mt-6 space-y-8 leading-relaxed [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-bold [&_p+p]:mt-3 [&_a]:break-words [&_a]:underline [&_li+li]:mt-2">
        <section aria-labelledby="privacy-local">
          <h2 id="privacy-local">1. 端末内に保存するデータ</h2>
          <p>Overlayは、PDFに書き込みを加えるWebアプリです。選んだPDF・挿入画像、線・テキスト・付箋・目隠しテープ、ページ構成、ノート名・フォルダ構造、保存設定などを、このブラウザ内のデータベース（IndexedDB）に保存します。</p>
          <p>Google Driveへ接続しなければ、ノートの内容をDriveへ送信しません。Overlayの運営者が管理するサーバーに、PDFや書き込みを保存する仕組みはありません。</p>
        </section>

        <section aria-labelledby="privacy-google">
          <h2 id="privacy-google">2. Google Driveへ接続した場合</h2>
          <p>Googleの画面で許可し、アカウントと保存先の確認が完了すると、このブラウザの全ノート・フォルダが、利用者自身のDriveにある専用フォルダ「Overlay」への自動保存対象になります。ノート一覧や付箋一覧を取得し、開くノートの内容を必要に応じて読み込みます。</p>
          <ul className="list-disc pl-6">
            <li>Googleから取得するアカウント識別子・表示名・メールアドレスは、接続先の確認と、別アカウントへの誤送信の防止に使用します。画面にはメールアドレスを表示します。</li>
            <li>PDF・画像・編集データ、ノート名・階層、付箋の要約、ファイルの識別子・更新情報などは、保存・読み込み・一覧表示・変更の競合確認に使用します。</li>
            <li>要求する権限は <code className="break-all">drive.file</code> です。Overlayが作成したファイルや、利用者がOverlayへの利用を許可したファイルを対象とし、Drive全体の読み書き権限は要求しません。</li>
          </ul>
          <p>ノートの内容はブラウザとGoogleの間で直接送受信します。Googleへの接続に使う短期の認可情報（アクセストークン）はページのメモリ内だけに保持し、データベースやサーバーには保存しません。GoogleのパスワードはOverlayでは取得しません。</p>
          <p>取得したGoogleユーザーデータは、上記の利用者向け機能の提供に使用します。広告・販売・AIモデルの学習には使用しません。Google APIから取得した情報の利用と他のアプリへの転送は、Limited Useの要件を含む <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a> に従います。</p>
        </section>

        <section aria-labelledby="privacy-retention">
          <h2 id="privacy-retention">3. 保存期間と一時保存</h2>
          <p>端末内のノートは、利用者による削除やブラウザのデータ消去などまで保存されます。ブラウザの仕様・空き容量によって消去される場合もあります。重要な内容はPDFや編集用バックアップとして手元に保管してください。</p>
          <p>Driveから再取得できるデータは、一時保存容量の設定と未使用時間に応じて端末から整理します。初期設定は250MB・未使用30分です。編集中・未送信・保存失敗・端末内だけのデータは自動整理の対象から外します。この設定はブラウザ内の全データ量を制限するものではありません。</p>
          <p>Drive上のデータは、利用者がDrive側で削除するまで残ります。送信前の変更は端末内に保護しますが、ページを閉じた後にDriveへの送信を継続することは保証しません。</p>
        </section>

        <section aria-labelledby="privacy-deletion">
          <h2 id="privacy-deletion">4. データの削除とGoogle連携の解除</h2>
          <ul className="list-disc pl-6">
            <li>ノートはOverlayのノート一覧から削除できます。ブラウザのサイトデータを消去すると、この端末の保存内容と設定が削除されます。未送信の編集も失われます。</li>
            <li>アプリ内の削除はDriveの共通一覧にも反映しますが、Drive上のPDF・編集ファイル・別の版・手動バックアップ自体は自動で削除しません。Drive上の内容も消す場合は、同期中のOverlayを閉じ、Google Driveの専用フォルダから対象を削除してください。Driveのゴミ箱も別途確認してください。</li>
            <li>Googleへのアクセス許可は <a href="https://myaccount.google.com/connections">Googleアカウントの接続管理</a> から取り消せます。許可を取り消しても、端末内やDriveに保存済みのデータは削除されません。</li>
          </ul>
          <p>編集用バックアップや書き出したPDFは暗号化していません。共有先と保管先は利用者自身で管理してください。</p>
        </section>

        <section aria-labelledby="privacy-services">
          <h2 id="privacy-services">5. 外部サービスとアクセス情報</h2>
          <p>サイトの配信にはVercel、任意のDrive連携にはGoogleを使用します。サイトへのアクセス時には、配信に必要なIPアドレス・ブラウザ情報・リクエスト情報などがVercel側で処理・記録される場合があります。Googleの認証用プログラムは、Driveの接続設定を開いた時に読み込みます。</p>
          <p>Overlayには、広告配信や独自のアクセス解析ツールを組み込んでいません。各サービスの取り扱いは <a href="https://vercel.com/legal/privacy-policy">Vercelのプライバシーポリシー</a> と <a href="https://policies.google.com/privacy">Googleのプライバシーポリシー</a> も参照してください。</p>
        </section>

        <section aria-labelledby="privacy-contact">
          <h2 id="privacy-contact">6. お問い合わせ・変更</h2>
          <p>開発者：momijyu。プライバシーに関するお問い合わせは <a href="mailto:momijyu.t0204@gmail.com" className="break-all">momijyu.t0204@gmail.com</a> で受け付けます。お問い合わせで受け取ったメールアドレス・内容は、返信と調査に使用します。パスワードや認証情報は送らないでください。</p>
          <p>取り扱いを変更する場合は、このページを更新します。Google連携で扱うデータや利用目的を変更する場合は、必要に応じてアプリ内で案内し、許可を求めます。</p>
        </section>
      </div>
      <footer className="mt-8 border-t border-base-300 pt-4"><SiteInfoLinks /></footer>
    </main>
  );
}
