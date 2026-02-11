# YARUYO

Family study declaration & completion app built with LIFF + Firebase.

------------------------------------------------------------------------

## Overview

YARUYO is a lightweight mobile-first study tracking app designed to run
inside LINE via LIFF.

Users can:

-   Declare what they will study (やるよ)
-   Record completion (やったよ)
-   View achievements (実績)
-   Manage settings (表示名 / 通知設定)

The app is optimized for smartphone usage inside LINE and designed for
minimal scrolling per screen.

------------------------------------------------------------------------

## Tech Stack

-   LIFF (LINE Front-end Framework)
-   Firebase Auth
-   Firestore
-   Cloud Functions (callable)
-   Firebase Emulator (local development)

------------------------------------------------------------------------

## Local Development

### Start Firebase Emulators

``` bash
firebase emulators:start --only auth,firestore,functions
```

### Start Local Server

``` bash
npx serve .
```

or use VSCode Live Server (recommended).

### Open Local UI

``` text
http://localhost:5500/liff/index.html?mode=local
```

Emulator mode banner should appear:

> Running in emulator mode. Do not use with production credentials.

------------------------------------------------------------------------

## URL Parameters

### View Switching

    ?view=declare
    ?view=record
    ?view=stats

When `view` is specified: - Top navigation tabs are hidden - Only the
specified screen is shown

### Local Mode

    ?mode=local

Enables: - Auth emulator connection - Firestore emulator connection -
Functions emulator connection - Anonymous auto-login

------------------------------------------------------------------------

## Screen Specifications

### 🟢 やるよ (Declare)

Fields:

-   いつから (start time dropdown)
    -   Default: 未定
    -   30-minute intervals
    -   Only future times
    -   Latest 21:30
-   なにを (subjects)
    -   Button multi-select (3 x 2 grid)
        -   英語 / 数学 / 国語
        -   理科 / 社会 / その他
-   どのくらい
    -   Amount dropdown (1--10)
    -   Type dropdown (時間 / ページ)
-   内容メモ（任意）

Submit Button:

    やるよ！

------------------------------------------------------------------------

### 🟢 やったよ (Record)

Flow:

1.  If multiple unfinished declarations → select first
2.  If one → skip selection
3.  If none → show guide to やるよ screen

Additional Field:

-   メモ（自由入力）

Submit Button:

    やったよ！

------------------------------------------------------------------------

### 🟢 実績 (Stats)

-   Card-based layout
-   Displays:
    -   User icon (LINE icon or fallback circle)
    -   Name
    -   評価（軽め / 予定通り / 多め）
    -   完了時刻

Click card → Modal showing:

#### やったよ

-   完了時刻
-   メモ

#### やるよ

-   なにを
-   いつから
-   分量
-   メモ

------------------------------------------------------------------------

### 🟢 設定 (Modal)

Opened via top-right gear icon.

Contains:

-   User icon + display name + UID (light bordered box)
-   表示名編集
-   宣言通知を受け取る
-   完了通知を受け取る

Saved to Firestore user profile.

------------------------------------------------------------------------

## Production Behavior (Planned)

-   LIFF login with LINE
-   LINE display name fetched on first login
-   Profile image fetched from LINE
-   Display name editable in settings

------------------------------------------------------------------------

## Future Tasks

-   LINE Login integration
-   Rich menu deep linking
-   Notification integration
-   Stats UI refinement
-   Avatar fallback styling
-   Family member management

------------------------------------------------------------------------

## Notes

-   Designed for single-screen mobile usage
-   Settings shown as modal (not full page)
-   Header visibility controlled by URL parameter when launched from
    rich menu

------------------------------------------------------------------------

Built with speed + iteration mindset.
