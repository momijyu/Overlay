# ノート用の日本語フォント

- Noto Sans JP Regular 2.004（未改変）
- Copyright: © 2014–2021 Adobe (http://www.adobe.com/).
- 配布元: https://github.com/notofonts/noto-cjk/blob/Sans2.004/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf
- ライセンス: SIL Open Font License 1.1。全文は同じディレクトリの`OFL.txt`。
- SHA-256: `dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073`

ノートのテキスト表示とPDF出力にだけ使用する。通常のUIのフォントは変更しない。
フォントは同じサイトから取得し、PDFやメモを外部へ送信しない。
初回のテキスト利用時に約4.3MiBを読み込み、以後は接続中のPromiseと結果を使い回す。
PDFにはフォント全体を埋め込む。CFFの部分埋め込みは字形が壊れるケースがあったため採用しない。
テキストを含む出力はフォントの分だけファイルサイズが増える。ペンだけのノートではフォントを読み込まない。
