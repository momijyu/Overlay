export function PdfWorkspace() {
  return (
    <section className="card border border-base-300 bg-base-100 shadow-sm">
      <div className="card-body items-center py-16 text-center">
        <h1 className="card-title text-2xl">PDFにノートを重ねよう</h1>
        <p className="max-w-lg text-base-content/70">
          PDFをアップロードし、ブラウザ上で書き込みを始めます。
        </p>

        <label className="btn mt-4" htmlFor="pdf-upload">
          PDFを選択
        </label>
        <input
          id="pdf-upload"
          className="sr-only"
          type="file"
          accept="application/pdf,.pdf"
        />
        <p className="text-sm text-base-content/60">
          現在は画面構成のみです。PDF表示とペン機能は次に実装します。
        </p>
      </div>
    </section>
  );
}
