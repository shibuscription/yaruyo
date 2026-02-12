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
-   Firebase Auth（本番でも匿名ログイン対応）
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
    -   匿名ログインを実行（LINE未連携時）

------------------------------------------------------------------------

## 🔗 URLパラメータ

### 画面切り替え

?view=declare\
?view=record\
?view=stats\
?view=settings

指定時：

-   上部ナビゲーション非表示
-   単画面表示

### ローカルモード

?mode=local

------------------------------------------------------------------------

## 🌐 Webプレビュー対応

ChromeなどLINE外ブラウザで開いた場合、 LIFF初期化に失敗しても
Webプレビューとして動作を継続します。

-   LINEプロフィール取得は行わない
-   仮表示名で動作
-   下部に「Webプレビューで動作中」表示

正式なLINE内起動は次工程で対応。

------------------------------------------------------------------------

## 📱 画面仕様

### 🟢 やるよ

（省略なし：既存仕様通り）

### 🟢 やったよ

（省略なし：既存仕様通り）

### 🟢 過去のやったよ

（省略なし：既存仕様通り）

### 🟢 設定

表示項目（主なもの）:

-   表示名編集
-   通知設定（やるよ / やったよ / 開始時刻リマインド）
-   家族招待コード（親用 / 子用、コピー可）

------------------------------------------------------------------------

## 🔔 開始時刻リマインド通知

### 動作仕様

-   30分ごとにスケジュール実行
-   JST基準
-   開始時刻 ±5分の範囲を対象
-   未完了かつ未送信の plan のみ
-   ユーザー設定が ON の場合のみ送信

------------------------------------------------------------------------

## 🔒 セキュリティ設計

-   records は client 直書き禁止
-   familyId による家族単位アクセス制御
-   Firestore Rules 管理化
-   インデックス管理化（firestore.indexes.json）

------------------------------------------------------------------------

## 🚀 デプロイ手順

firebase use prod

（初回のみ）`functions/.env.example` を `functions/.env` にコピーして値を設定

firebase deploy --only hosting\
firebase deploy --only functions\
firebase deploy --only firestore:rules\
firebase deploy --only firestore:indexes

※ Functions の環境変数は `functions/.env`（ローカル）/ `functions/.env.<alias>`（本番）を使用（`functions.config()` は不使用）。

### LINEリッチメニュー作成

環境変数を設定して実行:

`LINE_CHANNEL_ACCESS_TOKEN=...`
`LIFF_ID=2009111070-71hr5ID2`
`RICHMENU_IMAGE_PATH=...`

`node scripts/createRichMenu.js`

------------------------------------------------------------------------

## 💰 コスト注意

Cloud Functions v2 を使用しているため、Blazeプラン必須。\
少量利用であれば無料枠内で運用可能。

------------------------------------------------------------------------

Built with iteration mindset.
