# AI Dialogue Archiver Web — Prototype v0.1.0

ブラウザ内だけでAI対話を読み込み、内部整合性・本文差分・枝分かれ構造を検査し、Archive Bundle / v15 HTMLを出力するローカルファーストWebアプリです。

## 現在できること

- OpenAI Export ZIPを直接読み込み（`conversations.json`、番号付き会話JSONを探索）
- 展開済み `.json` の読み込み
- SingleFile等で保存した `.html` から `data-message-author-role` を使って会話本文を抽出
- 会話グラフの内部検査
  - missing parent / child
  - 非相互リンク
  - 重複 message ID
  - cycle
  - unreachable node
  - current_node 不整合
  - 認識可能なファイル参照の欠落
- SHA-256
  - 元ファイル
  - raw本文
  - 正規化本文
  - role+本文 anchor
  - 会話グラフ
- ID非依存の照合
  - 本文完全一致
  - 正規化本文一致
  - 最長共通部分列による経路比較
  - 編集 / 追加 / 削除表示
  - 経路外の枝検出
  - 本文＋枝構造が一致し、重複本文による構造曖昧性が残らない場合 GRAPH VERIFIED
  - 一本の会話経路が一致した場合 PATH VERIFIED
- Archive Bundle ZIP出力
  - `originals/` 原本ファイル
  - `manifest.json`
  - normalized project
  - conversation JSON
  - integrity report
  - cross-source comparison report
- 選択会話の自己完結 v15 HTML生成
- IndexedDBへの検査結果/正規化データ保存
- PWA / Service Workerによるオフライン利用（HTTPSでホストした場合）

## 重要な意味区分

- **INTERNAL PASS**: 読み込んだ資料内部で、検出可能な構造矛盾がない。
- **PATH VERIFIED**: 2つの資料で一本の会話経路の本文・順序が一致。
- **GRAPH VERIFIED**: User/Assistant本文の多重集合・親子エッジ・近傍構造がID非依存で一致し、同一近傍の重複本文による曖昧性が残らない。
- どの表示も「OpenAI側に存在したが、すべての入力資料から同時に欠けたデータ」の不存在までは証明しません。

## 起動

Service Worker / Web Crypto / OPFS等のWeb機能を正しく使うため、`file://` 直開きではなくHTTPSまたはlocalhostで開いてください。

PC/Macの例:

```bash
python3 -m http.server 8080
```

その後 `http://localhost:8080` を開きます。

iPad/iPhoneでは、このフォルダを静的ホスティング（HTTPS）へ配置しSafariで開き、「ホーム画面に追加」するとPWAとして利用できます。

## プライバシー

アプリ自身はアップロードAPIを持ちません。選択したファイルはブラウザ内で解析されます。外部ライブラリもローカル同梱です（JSZip）。

## 第三者ライブラリ

`vendor/jszip.min.js` — JSZip, MIT / GPLv3 dual license. ライセンス文は `vendor/JSZIP_LICENSE.txt` を参照。
