"use client";

import { useEffect, useRef, useState } from "react";
import { editorToolGroups } from "../editorTools";
import { EditorIcon } from "./EditorIcon";

const topics = [
  ["start", "PDFを開く"], ["tools", "道具のアイコン"], ["text", "テキスト・付箋"],
  ["move", "移動・コピー"], ["pages", "ページの操作"], ["save", "保存・書き出し"], ["organize", "ノートの整理"],
] as const;
type Topic = typeof topics[number][0];

export function EditorHelpDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [topic, setTopic] = useState<Topic>("start");
  const [device, setDevice] = useState<"pc" | "touch">(() =>
    typeof window !== "undefined" && window.matchMedia("(width < 640px), (hover: none) and (pointer: coarse)").matches ? "touch" : "pc");
  const touch = device === "touch";
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return <dialog id="editor-help" ref={ref} className="modal" aria-labelledby="editor-help-heading"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="editor-help-box modal-box flex max-h-[calc(100dvh-1rem)] max-w-3xl flex-col overflow-hidden rounded-box p-4 sm:p-6">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-base-300 pb-3">
        <h2 id="editor-help-heading" className="text-lg font-semibold">使い方</h2>
        <button type="button" className="btn btn-sm min-h-11" autoFocus onClick={onClose}>閉じる</button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="join" role="group" aria-label="操作する端末">
            <button type="button" className={`btn join-item min-h-11 ${touch ? "" : "btn-active"}`}
              aria-pressed={!touch} onClick={() => setDevice("pc")}>PC</button>
            <button type="button" className={`btn join-item min-h-11 ${touch ? "btn-active" : ""}`}
              aria-pressed={touch} onClick={() => setDevice("touch")}>スマホ・iPad</button>
          </div>
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-sm">項目</span>
            <select className="select min-h-11 w-full min-w-0" value={topic}
              onChange={(event) => setTopic(event.target.value as Topic)}>
              {topics.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <section aria-labelledby="editor-help-topic" className="space-y-4 text-sm leading-relaxed">
          <h3 id="editor-help-topic" className="text-base font-semibold">{topics.find(([key]) => key === topic)![1]}</h3>
          {topic === "start" && <ol className="list-decimal space-y-3 pl-5">
            <li>「PDFを開く」から資料を選びます。別の資料を開くときは、左上の三本線から選べます。</li>
            <li>道具を選び、ページに書き込みます。変更を確定すると自動保存が始まります。開いただけのPDFは保存されません。</li>
            <li>左上の三本線でノート一覧を開き、ノート名を押して編集を再開します。</li>
            <li>{touch ? "編集中は右上の「…」から、この使い方や書き出しを開けます。" : "アイコンにマウスを重ねると道具名が表示されます。上部の「使い方」で説明を開けます。"}</li>
          </ol>}
          {topic === "tools" && <div className="space-y-5">
            {editorToolGroups.map((group) => <section key={group.label} className="space-y-2">
              <h4 className="font-semibold">{group.label}</h4>
              <dl className="space-y-3">{group.tools.map((entry) => <div key={entry.tool} className="flex items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-box border border-base-300"><EditorIcon name={entry.tool} /></span>
                <div className="min-w-0"><dt className="font-medium">{entry.label}</dt><dd className="text-base-content/75">{entry.description}</dd></div>
              </div>)}</dl>
            </section>)}
            <p>曲がった左右の矢印は「元に戻す」「やり直す」です。倍率は10〜300%で変更できます。</p>
            {touch && <p>選択中の道具をもう一度押すと、設定を開閉できます。横向きでは設定を上部に表示します。</p>}
          </div>}
          {topic === "text" && <ol className="list-decimal space-y-3 pl-5">
            <li>テキストボックスか付箋を選び、追加ボタンまたはページ上の空白を押します。{touch && "設定が閉じているときは、上部の設定アイコンから開けます。"}</li>
            <li>文字を入力し、スライダーや数値で文字サイズを変更します。文字色と付箋の背景色も変更できます。</li>
            <li>「完了」か入力欄の外側を押して確定します。{!touch && "Ctrl／Command+Enterでも確定、Escapeで取り消せます。"}</li>
            <li>{touch ? "既存のメモをタップして選択し、「編集」で入力を開きます。枠をドラッグすると移動できます。" : "既存の文章を押すと編集、枠をドラッグすると移動できます。"}</li>
            <li>{touch ? "上部の付箋一覧ボタン" : "画面右端の矢印付き「付箋」タブ"}から現在の資料の付箋へ移動できます。全資料の「付箋一覧」はノート一覧にあります。</li>
          </ol>}
          {topic === "move" && <div className="space-y-4">
            <p>{touch ? "二本指でページを移動し、指の間隔を変えると拡大・縮小できます。一本指でページを動かすときは手の道具を選びます。" : "手の道具を選んでドラッグするとページを移動できます。倍率スライダーかCtrl／Command＋ホイールで拡大・縮小できます。"}</p>
            <p>書き込みをまとめて動かすときは投げ縄を選び、線・テキスト・付箋の全体を囲みます。選択枠内をドラッグすると移動できます。</p>
            <p>{touch ? "選択後の「コピー」「貼り付け」で複製します。" : "選択後の「コピー」「貼り付け」、またはPDF上でCtrl／Command+C・Vを使います。文章入力中は通常の文字コピー・貼り付けになります。"}</p>
            <p>画像は画像ツールで選択し、枠で移動、右下で拡縮します。回転・切り抜き・画像同士の前後変更も設定から行えます。</p>
          </div>}
          {topic === "pages" && <div className="space-y-4">
            <p>左右のページ矢印で移動します。「ページ操作」から、次の位置に無地・罫線・方眼の白紙を追加できます。</p>
            {!touch && <p>PDFの左側にあるページ一覧で、プレビューを押すとそのページへ移動できます。上の矢印で一覧を閉じると、資料を広く表示できます。</p>}
            <p>「ページを削除」はページとその書き込みを削除します。最後の1ページは削除できません。</p>
            <p>「書き込みを一括削除」は、表示中のページの線・付箋・テキスト・目隠しテープを種類別に消します。元PDFの内容は消しません。</p>
            <p>編集・ページ削除は元に戻すで取り消せます。履歴は直近100操作までで、ノートの切り替え・再読み込みでリセットされます。</p>
            <p>広い画面では「見開き」で2ページ表示できます。押した側のページが編集とページ操作の対象になります。</p>
          </div>}
          {topic === "save" && <div className="space-y-4">
            <p>変更の確定後に自動保存します。保存中・失敗時は画面に表示します。失敗した場合は表示された再試行を押してください。</p>
            <dl className="space-y-3">
              <div><dt className="font-semibold">ブラウザ内保存</dt><dd>Drive未連携時の保存先です。別端末・別ブラウザ・別URLとは共有されず、サイトデータを消すと失われます。</dd></div>
              <div><dt className="font-semibold">Google Drive</dt><dd>ノート一覧の「接続設定」で連携すると、全ノート・フォルダを自分のDriveへ自動保存します。PC・スマホでは同じGoogleアカウントに接続し、ノート一覧から開きます。再接続の案内が出たら接続してください。未送信の編集は端末に保持します。</dd></div>
              <div><dt className="font-semibold">PDFを書き出す</dt><dd>{touch ? "右上の「…」" : "「書き出し」"}から選びます。閲覧・共有用です。ページの指定もできます。書き込みの再編集用バックアップにはならず、目隠しテープは出力しません。</dd></div>
              <div><dt className="font-semibold">編集用バックアップ</dt><dd>再編集用のPDF・書き込みをまとめます。1件は.overlay、複数やフォルダはZIPで保存できます。ファイルを読み込むと既存ノートを上書きせずコピーを追加します。</dd></div>
            </dl>
            <p className="text-red-400">※ 重要なノートは定期的に書き出して保管してください。目隠しテープは機密情報の墨消しには使えません。</p>
          </div>}
          {topic === "organize" && <div className="space-y-4">
            <p>左上の三本線でノート一覧を開きます。フォルダ名の矢印で開閉し、ノート名を押すと開きます。</p>
            <p>項目を選んで「操作」から名前変更・移動・削除ができます。フォルダを選ぶと、その中に新しいフォルダを作れます。</p>
            <p>{touch ? "項目を長押ししてから指を動かすと、フォルダへドラッグ移動できます。" : "ノートやフォルダを、移動先のフォルダへドラッグできます。"}</p>
            <p>「複数選択」でチェックし、同じボタンのメニューから移動・削除・ZIP保存を選べます。フォルダをチェックすると子も選ばれます。ノート一覧を閉じると選択は終了します。</p>
            <p>雲のマークは、本文をDriveから取得して開くノートです。Drive未接続時は、このブラウザで開けるノートだけを表示します。</p>
            <p className="text-red-400">※ ノート・フォルダの削除は元に戻せません。確認画面で対象を確かめてください。</p>
          </div>}
        </section>
      </div>
    </div>
    <form method="dialog" className="modal-backdrop" onSubmit={(event) => { event.preventDefault(); onClose(); }}>
      <button type="submit" aria-label="使い方を閉じる">閉じる</button>
    </form>
  </dialog>;
}
