# AI Dialogue Archiver Web — v0.5.6

AI対話をブラウザ内で読み込み、保存・閲覧・内部整合性検査・本文/枝分かれ照合・Archive Bundle / v15 HTML出力まで行うローカルファーストWebアプリです。



## v0.5.6 の中心変更

- 初期画面を本文ビューアと同じタイポグラフィ・操作列寸法へ統一。初期画面全体を固定し、右側Libraryのみスクロール可能に変更。
- 初期上段を「保存/出力選択・黒テッセラクト実行・Quick/Verify・検索・Title/Full Text」に再構成。
- 左列をChatGPTカード系の「資料を読み込む / 検証」、右列をUserカード系の「保存済み会話」に整理。A/B検証枠は縦並び。
- 設定アイコンをテーマ点と同径の7つの外接円に変更。UI言語は日本語 / Englishの2択のみ。
- 黒ボタンの展開矢印を廃止し、Image Promptsも同じ固定幅へ統一。Preview / Transcript / Title / Full Textは最長語基準の固定幅。
- Overviewを本文上の数行パネルから、Summary上段 + Key Concepts/Keywords下段の固定1画面へ変更。モーヴ系の低彩度枠と凹型の立体感を採用。
- Overview表示中に本文検索を実行するとOverviewを閉じて該当本文へ移動。
- Previewに予備黒ボタンと独立したPrompt検索を追加。
- APP_VERSION / Service Worker cacheをv0.5.6へ更新。

## v0.5.5 の中心変更

- 初期画面を本文/Previewと同じ **1000px中央表示ライン** に統一。
- 中央領域を **左: 操作 / 右: Library** に分割し、Libraryだけを高密度スクロール表示。
- 保存・出力を上段へ移動し、検証は折りたたみ。Library会話をA/Bへドラッグ、またはA/Bボタンで検証資料へ設定可能。
- 初期画面の検索を **Title / Full Text** 切替にし、全保存会話を横断する単語検索・ファイル件数・本文ヒット件数・スニペット表示を追加。
- 初期タイトルを `AI Dialogue Archiver` に統一。仕様説明は `…` パネル内へ移動し、Visual Replicaメニューと同一の背景/影/blurを使用。
- 7つの小円から成る設定アイコンを追加。`日本語 / English / 日本語＋English` をローカル設定として切替可能。
- LOCAL重要語句抽出を改善。ひらがな機能語・一般的な断片を除外し、漢字/カタカナ/英字、会話内分散、両話者、タイトル一致、Library内希少性を加味。
- Overview / keywords / aiAnnotations をConversation保存時に保持するよう拡張。
- APP_VERSION / Service Worker cache を v0.5.5 へ更新。

## v0.5.3 の中心変更

- v0.5.2 FULLを基準に差分更新。既存の保存・検証・ライブラリ構成は維持。
- 画像だけのメッセージをHTML取り込み時に落とさないよう修正。
- 数式/LaTeX/MathJax画像・アバター・絵文字・UIアイコンはImage Indexから除外し、会話内画像/添付は保持。
- 検索は入力中に件数のみ更新、Enter / Shift+Enterで移動。検索解除時は検索開始前のDOMと読書位置へ復元。
- Visual Replica / Semantic Transcript / Raw Original切替は message ID + message内位置で同期。画像だけのメッセージにもSemantic側の対応ノードを保持。
- Overview / layer selector / 検索→ボタンを、ユーザー指定のv15スクリーンショットに合わせた中明度グラファイトの立体質感へ調整。
- APP_VERSION / Service Worker cache を v0.5.3 へ更新。

## v0.5.1 の中心変更

- v15基準の閲覧ヘッダー／対話カード／PreviewをWebアプリ内ライブラリへ統合
- 検索は入力中に件数のみ更新し、Enter / Shift+Enterで初めて一致位置へ移動
- 検索解除時に検索開始前の閲覧位置へ復帰、検索マーカーを高輝度化
- Visual Replica / Semantic Transcript / Raw Original切替をメッセージID基準で位置同期
- 数式SVG画像をPreviewの画像一覧から除外
- Previewは画像タップで拡大、番号タップで本文位置へ移動
- Image Indexはサムネイル下のサイズ＋プロンプト表示を切替、Image Promptsは番号＋サイズ＋プロンプトのみ
- Light/Dark、操作、戻るボタンをPreview/Transcript切替と同系統の立体UIへ統一
- 同一資料・同一SHA-256資料の自己照合をCROSS-SOURCE検証として扱わない


## v0.3.0 の中心変更

- **Webアプリ内ライブラリ**を追加
  - 選択した会話を IndexedDB に保存
  - 次回同じGitHub Pages URLをSafariで開いたとき、保存済み会話を一覧表示
  - タイトル/保存元検索
- **Webアプリ内閲覧**を追加
  - User / ChatGPT本文をその場で閲覧
  - 本文検索
  - 表・コード・画像・SVG等のrich HTMLを安全化して表示
  - 会話グラフに複数の子がある地点では枝を切り替えて閲覧
- **保存済み会話から再利用**
  - 検証画面へ再読込
  - v15 HTMLとして書き出し
  - ライブラリから削除
- **ローカル原本保持**
  - 対応環境では読み込み元ファイルをOPFSにも保存
  - `navigator.storage.persist()` を要求し、可能な範囲でSafariの自動削除耐性を上げる
- **v0.2ローカル記録の移行**
  - 旧 `projects` ストアに保存済みの会話は、初回起動時に新ライブラリへ可能な範囲で自動移行
- **Service Worker更新**
  - GitHub Pages更新後に古いCSS/JSが残りにくいよう、同一オリジンの静的ファイルを network-first に変更

## 読み込み

- OpenAI Export ZIP
- ChatGPT会話JSON
- 旧v15 HTML / v0.2+ v15 HTML
- SingleFile等のHTMLキャプチャ

## 検証

- 親子参照、重複、循環、到達不能、current_node、認識可能な添付参照
- SHA-256: 原本、本文、正規化本文、会話グラフ
- ID非依存の本文・順序・枝分かれ照合
- INTERNAL PASS / PATH VERIFIED / GRAPH VERIFIED を分離

## iPhone / iPad基準

主な閲覧経路は **SafariでGitHub Pages上のWebアプリを開き、アプリ内ライブラリから読む** 方式です。
ローカル `.html` をiOSのFilesから直接開くことは主経路にしません。

Macではv15 HTMLをSafariで直接開く運用も可能です。

## 保存上の注意

Webアプリ内ライブラリはSafariのサイトデータです。Safariの「Webサイトデータ」を削除した場合や、OS/ブラウザの保存領域管理によって失われる可能性があります。
重要な会話は以下も併用してください。

- Archive Bundle ZIP: 原本・manifest・検査結果のバックアップ
- v15 HTML: 可搬な自己完結閲覧用アーカイブ

## プライバシー

会話解析・ライブラリ保存・検証はブラウザ内で行います。アプリ自身は会話アップロードAPIを持ちません。

## 第三者ライブラリ

`vendor/jszip.min.js` — JSZip (MIT / GPLv3 dual license)。ライセンス文は `vendor/JSZIP_LICENSE.txt`。


## v0.4 privacy policy

Conversation archives are treated as local data. Imported HTML is parsed through an external-resource neutralization step, and the app applies a CSP that blocks automatic third-party subresource loads. External images are shown as explicit click gates; ordinary external links open only after a user click and use a no-referrer policy. Raw originals remain unchanged for archival fidelity.

## v0.5.2 UI refinement

- Overview / layer selector controls use the roomier v15 UI11.4-inspired graphite size and depth.
- The three layer choices inherit the same size/material; their opened panel uses a slightly translucent related graphite surface.
- Preview / Transcript and the top-right theme / more / back controls regain stronger glass depth in both Light and Dark modes.
- Top-right glyphs and the theme dot use palette-derived gray tones rather than absolute black/white.

# v0.5.4

Compact initial dashboard, synchronized Light/Dark theme, refined reader navigation/materials, inline reader metadata, and deterministic local keyword extraction. See `UPDATE_v0.5.4.md`.
