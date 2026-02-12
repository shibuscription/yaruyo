# YARUYO

LINE（LIFF）上で動作する、家族向け学習宣言＆記録アプリ。

------------------------------------------------------------------------

## 🧭 概要

YARUYO は、LINE内で動作するモバイルファースト設計の学習トラッカーです。

ユーザーは：

-   やることを宣言する（やるよ）
-   完了を記録する（やったよ）
-   過去のやったよを振り返る
-   通知や表示名を設定する

30分刻み設計・JST基準で統一されたシンプルな構造です。

------------------------------------------------------------------------

## 🛠 技術スタック

-   LIFF（LINE Front-end Framework）
-   Firebase Auth（LIFF内はLINE連携、Webプレビューは匿名ログイン）
-   Firestore（本番DB構築済み）
-   Cloud Functions v2（Blazeプラン必須）
-   Firebase Hosting
-   Firebase Emulator（ローカル開発用）

------------------------------------------------------------------------

## 🔥 本番環境ステータス

-   Firebase 本番プロジェクト構築済み
-   Blaze（従量課金）プラン移行済み
-   Firestore 本番データベース作成済み
-   セキュリティルール適用済み
-   複合インデックス管理化（firestore.indexes.json）
-   Functions v2 本番デプロイ済み
-   Webブラウザ用 LIFF フォールバック対応

------------------------------------------------------------------------

## 💻 ローカル開発

### Firebase Emulator 起動

firebase emulators:start --only auth,firestore,functions

### フロントエンド起動

npx serve .

または VSCode Live Server（推奨）

### ローカルUI確認URL

http://localhost:5500/liff/index.html?mode=local

表示バナー：

Running in emulator mode. Do not use with production credentials.

### ローカル / 本番 接続切替

-   `?mode=local` あり:
    -   Auth / Firestore / Functions を Emulator に接続
    -   匿名自動ログイン
-   `?mode=local` なし:
    -   本番 Firebase Project に接続
    -   LIFF内: LINEログイン + Firebase連携
    -   LINE外(Webプレビュー): 匿名ログイン

------------------------------------------------------------------------

## 🔗 URLパラメータ

### 画面切り替え

?view=declare\
?view=record\
?view=stats\
?view=plans\
?view=settings

指定時：

-   上部ナビゲーション非表示
-   単画面表示

補足:

-   `?view=yaruyo` は `?view=declare` と同等扱い
-   `?view=record&planId=<planId>` で対象 plan を初期選択

### キャッシュバスター

`?v=<buildId>`（例: `?view=declare&v=20260213-1`）

### ローカルモード

?mode=local

### デバッグ表示

?debug=1（設定画面にLIFF/プロフィール取得情報を表示）

------------------------------------------------------------------------

## 🌐 Webプレビュー対応

ChromeなどLINE外ブラウザで開いた場合、 LIFF初期化に失敗しても
Webプレビューとして動作を継続します。

-   LINEプロフィール取得は行わない
-   仮表示名で動作
-   下部に「Webプレビューで動作中」表示

LIFF内起動時は profile（displayName / pictureUrl）を users に同期。

------------------------------------------------------------------------

## 📱 画面仕様

### 🟢 やるよ

-   宣言成功後はトースト表示後に `view=plans` へ遷移
-   右端リンク `ほかのやるよ（N）`（N>0のときのみ表示）

### 🟢 やったよ

-   `?view=record&planId=<id>` で対象 plan を初期選択

### 🟢 過去のやったよ

-   無限スクロール（初期20件 + 追加読み込み）

### 🟢 ほかのやるよ（view=plans）

-   自分の未完了plan一覧（`status=declared`）を表示
-   無限スクロール（初期50件 + 追加読み込み）
-   各行:
    -   行クリックで詳細モーダル
    -   [やったよ] で `view=record&planId=<id>` へ遷移
    -   [削除] は confirm 後に論理削除（`status=cancelled`, `cancelledAt`）

### 🟢 設定

表示項目（主なもの）:

-   表示名編集
-   通知設定（やるよ / やったよ / 開始時刻リマインド）
-   家族招待コード（親用 / 子用、コピー可）
-   UIDは短縮表示 + コピー対応（`?debug=1` でフルUID表示）

------------------------------------------------------------------------

## 🔔 開始時刻リマインド通知

### 動作仕様

-   30分ごとにスケジュール実行
-   JST基準
-   開始時刻 ±5分の範囲を対象
-   未完了かつ未送信の plan のみ
-   ユーザー設定が ON の場合のみ送信
-   通知文:
    -   1行目固定 `⏰ HH:MMから「教科」の時間だよ！`
    -   2行目は20候補からランダム

### アクティビティ通知（やるよ / やったよ）

-   送信対象は同一家族の active メンバー
-   本人も送信対象（通知設定がONの場合）
-   受信判定:
    -   やるよ通知: `users.notifyActivityPlan == true`
    -   やったよ通知: `users.notifyActivityRecord == true`
-   重複送信は `notificationLogs`（dedupeKey）で抑止

------------------------------------------------------------------------

## 🔒 セキュリティ設計

-   records は client 直書き禁止
-   familyId による家族単位アクセス制御
-   Firestore Rules 管理化
-   インデックス管理化（firestore.indexes.json）
-   inviteCodes は parent のみ read
-   plan削除は物理deleteせず cancelled 更新

------------------------------------------------------------------------

## 🚀 デプロイ手順

firebase use prod

（初回のみ）`functions/.env.example` を `functions/.env` にコピーして値を設定

firebase deploy --only hosting\
firebase deploy --only functions\
firebase deploy --only firestore:rules\
firebase deploy --only firestore:indexes

※ Functions の環境変数は `functions/.env`（ローカル）/ `functions/.env.<alias>`（本番）を使用（`functions.config()` は不使用）。

### Hostingキャッシュ方針（重要）

-   `/liff/index.html` は `no-cache, max-age=0, must-revalidate`
-   `/liff/js/**` と `/liff/css/**` は短期キャッシュ（`max-age=300`）
-   rewrite は `/liff/!(js|css|img|assets)/** -> /liff/index.html`（アセット除外）

### LINEリッチメニュー作成

環境変数を設定して実行（`v=` 付きURLで強キャッシュ対策）:

`LINE_CHANNEL_ACCESS_TOKEN=...`
`LIFF_ID=2009111070-71hr5ID2`
`RICHMENU_IMAGE_PATH=...`
`YARUYO_BUILD_ID=20260213-1`（任意。未指定時は実行時刻で自動生成）

`node scripts/createRichMenu.js`

推奨運用順:

1. `firebase deploy --only hosting`
2. `node scripts/createRichMenu.js`（新しい build id で更新）

------------------------------------------------------------------------

## 💰 コスト注意

Cloud Functions v2 を使用しているため、Blazeプラン必須。\
少量利用であれば無料枠内で運用可能。

------------------------------------------------------------------------

Built with iteration mindset.
