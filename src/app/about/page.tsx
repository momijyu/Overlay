import type { Metadata } from "next";
import Link from "next/link";
import { SiteInfoLinks } from "@/components/layout/SiteInfoLinks";
import { UsageGuideButton } from "./UsageGuideButton";

const title = "Overlayについて | Overlay";
const description = "PDFに手書き・テキスト・付箋を重ねるノート。基本操作、保存先、書き出し方法を紹介します。";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, url: "/about" },
  twitter: { title, description },
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-8 text-base-content sm:px-8 sm:py-12">
      <header className="border-b border-base-300 pb-6">
        <h1 className="text-3xl font-bold">Overlay</h1>
        <p className="mt-3 text-lg">PDFに書き込むのーと</p>
        <p className="mt-4 leading-relaxed">講義資料や演習プリントなどのPDFを開き、手書き・テキスト・付箋を重ねられます。PC・スマホ・iPadのブラウザで使えます。</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/" prefetch={false} className="btn btn-primary min-h-11">ノートを開く</Link>
          <UsageGuideButton />
        </div>
      </header>
      <div className="mt-6 space-y-8 leading-relaxed [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-bold [&_p+p]:mt-3 [&_li+li]:mt-2 [&_a]:underline">
        <section aria-labelledby="about-start">
          <h2 id="about-start">使い始める</h2>
          <ol className="list-decimal pl-6">
            <li>「ノートを開く」から編集画面へ進み、「PDFを開く」で資料を選びます。</li>
            <li>ペンや付箋などの道具を選び、ページ上に書き込みます。確定した変更は自動保存されます。PDFを開いただけでは保存されません。</li>
            <li>ノート一覧から、保存した資料を開き直して続きを編集できます。</li>
          </ol>
        </section>
        <section aria-labelledby="about-features">
          <h2 id="about-features">できること</h2>
          <ul className="list-disc pl-6">
            <li>ペン・マーカー・消しゴム、テキスト・付箋、図形・画像の追加、書き込みの選択・移動、元に戻す・やり直す。</li>
            <li>白紙・罫線・方眼ページの追加、ページの削除、復習用の目隠しテープ。</li>
            <li>フォルダでの整理、付箋一覧から資料・ページへの移動、PCでのページ一覧・見開き表示。</li>
          </ul>
        </section>
        <section aria-labelledby="about-storage">
          <h2 id="about-storage">保存先</h2>
          <div className="space-y-4">
            <div className="rounded-box border border-base-300 p-4">
              <h3 className="font-bold">接続しない場合：このブラウザ</h3>
              <p className="mt-2">アカウント登録なしで使えます。PDFと書き込みは利用中のブラウザ内に保存され、別の端末・ブラウザとは共有されません。</p>
            </div>
            <div className="rounded-box border border-base-300 p-4">
              <h3 className="font-bold">Google Driveへ接続した場合：自分のDrive</h3>
              <p className="mt-2">接続先の確認が完了すると、このブラウザの全ノート・フォルダを専用フォルダ「Overlay」へ自動保存します。同じGoogleアカウントで接続した別の端末でも開けます。未送信の変更は端末内に保持します。</p>
              <p>接続には、Googleアカウントの確認と、Overlayが扱うファイルへのアクセス許可を使います。ノートはブラウザとGoogleの間で直接送受信し、Overlayの運営者のサーバーには保存しません。</p>
            </div>
          </div>
          <p>ブラウザのデータ消去や端末の空き容量などによって、端末内の内容が失われる場合があります。Driveへの送信にも時間がかかるため、重要なノートは書き出して保管してください。データの利用・保存・削除の詳細は<Link href="/privacy" prefetch={false}>プライバシーポリシー</Link>に記載しています。</p>
        </section>
        <section aria-labelledby="about-export">
          <h2 id="about-export">手元に残す・人に渡す</h2>
          <ul className="list-disc pl-6">
            <li>「PDFを書き出す」：書き込みを重ねたPDFを保存します。全ページ・指定ページを選べます。復習用の目隠しテープは含めません。</li>
            <li>「編集用バックアップ」：元PDFと書き込みを保存します。Overlayへ読み込むと再編集できます。複数ノート・フォルダは編集用ZIPでまとめて保存できます。</li>
          </ul>
          <p>Google Drive連携は、自分の端末間でノートを使うための機能です。他の人とのリアルタイム共同編集には対応していません。</p>
        </section>
        <section aria-labelledby="about-contact">
          <h2 id="about-contact">お問い合わせ</h2>
          <p>開発者：momijyu。不具合・要望・お問い合わせは<a href="mailto:momijyu.t0204@gmail.com" className="break-all">momijyu.t0204@gmail.com</a>へお願いします。パスワードや認証情報は送らないでください。</p>
        </section>
      </div>
      <footer className="mt-8 border-t border-base-300 pt-4"><SiteInfoLinks /></footer>
    </main>
  );
}
