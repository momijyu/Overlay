import type { Metadata } from "next";
import Link from "next/link";
import { SiteInfoLinks } from "@/components/layout/SiteInfoLinks";

const title = "利用規約 | Overlay";
const description = "Overlayの利用条件、資料・書き込みの権利、保存と書き出し、サービスの変更について。";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, url: "/terms" },
  twitter: { title, description },
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-8 text-base-content sm:px-8 sm:py-12">
      <Link href="/" prefetch={false} className="link link-hover text-sm">Overlayを開く</Link>
      <header className="mt-6 border-b border-base-300 pb-6">
        <h1 className="text-2xl font-bold">利用規約</h1>
        <p className="mt-2 text-sm text-base-content/70">更新日：2026年11月16日</p>
      </header>
      <div className="mt-6 space-y-8 leading-relaxed [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-bold [&_p+p]:mt-3 [&_a]:break-words [&_a]:underline [&_li+li]:mt-2">
        <section aria-labelledby="terms-service">
          <h2 id="terms-service">1. サービスと利用条件</h2>
          <p>この規約は、momijyuが提供するPDF書き込みアプリ「Overlay」の利用条件を定めます。利用する機能と、保存・書き出しの方法を確認してお使いください。</p>
          <p>基本機能はアカウント登録なしで利用できます。Google Drive連携は任意です。連携には利用者自身のGoogleアカウントとアクセス許可が必要で、Google側の利用条件も適用されます。</p>
        </section>
        <section aria-labelledby="terms-rights">
          <h2 id="terms-rights">2. 資料・書き込みの権利</h2>
          <p>取り込んだPDF・画像や、利用者が作成した書き込みの権利は、利用者または元の権利者に帰属します。Overlayを使っても、これらの権利が運営者へ移ることはありません。</p>
          <p>資料の取り込み・加工・書き出し・共有は、著作権、プライバシー、配布元の条件などを確認し、必要な権限がある範囲で行ってください。講義資料などを他の人へ渡す場合も、配布元の許可や共有範囲を確認してください。</p>
          <p>この規約は、Overlayのソースコードや同梱するフォント・アイコンなどの再配布ライセンスを定めるものではありません。第三者の著作物には、それぞれの利用条件が適用されます。</p>
        </section>
        <section aria-labelledby="terms-prohibited">
          <h2 id="terms-prohibited">3. 禁止する行為</h2>
          <ul className="list-disc pl-6">
            <li>他の人の著作権・プライバシーなどの権利を侵害する行為。</li>
            <li>他の人のアカウントやデータへの不正なアクセス、認証情報の不正な取得・利用。</li>
            <li>サービスや外部サービスへ意図的に過剰な負荷をかけるなど、運用を妨げる行為。</li>
            <li>法令に違反する行為。</li>
          </ul>
        </section>
        <section aria-labelledby="terms-storage">
          <h2 id="terms-storage">4. 保存・削除・書き出し</h2>
          <p>Google Driveへ接続しない場合、ノートは利用中のブラウザ内へ保存します。Driveへ接続して保存先の確認が完了すると、このブラウザの全ノート・フォルダが利用者自身のDriveへの自動保存対象になります。データの取り扱いと削除方法は<Link href="/privacy" prefetch={false}>プライバシーポリシー</Link>を確認してください。</p>
          <p>ブラウザのデータ消去・空き容量、通信障害、認証期限切れ、外部サービスの障害などにより、保存・同期・読み込みが完了しない場合があります。未送信の変更がある状態でページを閉じたりサイトデータを消したりすると、内容を失う場合があります。</p>
          <p>重要な内容は、PDFと再編集用のバックアップを必要に応じて書き出し、利用者自身で保管してください。ノートやページなどの削除は、確認画面に表示される対象と取り消しの可否を確かめてから行ってください。</p>
          <p>目隠しテープは復習用の表示機能です。元の文字や画像を消去する機能ではなく、PDFへも出力しません。個人情報や機密情報の墨消しには使用しないでください。</p>
        </section>
        <section aria-labelledby="terms-availability">
          <h2 id="terms-availability">5. 動作とサービスの変更</h2>
          <p>利用できる機能や表示は端末・ブラウザによって異なります。すべてのPDFの表示・出力、常時の利用、即時のDrive同期を保証するものではありません。提出・共有するファイルは、書き出した内容を確認してください。</p>
          <p>不具合の修正、外部サービスの変更、運用上の事情などにより、機能を変更・中断・終了する場合があります。利用に大きく影響する変更や終了は、可能な限り事前にサイト上で案内します。</p>
          <p>この規約は、法令に基づく利用者の権利を制限したり、運営者が法令上負う責任を免除したりするものではありません。</p>
        </section>
        <section aria-labelledby="terms-contact">
          <h2 id="terms-contact">6. 規約の変更・お問い合わせ</h2>
          <p>規約を変更する場合は、変更内容と適用日をこのページなどで案内します。重要な変更は事前に案内し、法令上必要な手続きがある場合は、その手続きに従います。</p>
          <p>お問い合わせは<a href="mailto:momijyu.t0204@gmail.com" className="break-all">momijyu.t0204@gmail.com</a>へお願いします。パスワードや認証情報は送らないでください。</p>
        </section>
      </div>
      <footer className="mt-8 border-t border-base-300 pt-4"><SiteInfoLinks /></footer>
    </main>
  );
}
