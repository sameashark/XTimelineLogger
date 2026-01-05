# X Timeline Logger

[日本語](#概要) / [English](#overview)

---

## 概要
X（旧Twitter）のタイムラインに流れてくるポストを自動的に検出し、手元のリストに一時保存するブラウザ補助ツール（UserScript）です。
「さっき流れていってしまったあのポストをもう一度見たい」といった際の見逃しを防止します。

## 特徴
- **一覧性に特化したUI**: タイムラインの情報をコンパクトに凝縮。短時間で大量のポストを振り返るのに最適です。
- **表示の柔軟性**: タイムラインの並べ替え、リポストの非表示や画像サムネイルのオフ機能を搭載。さらに一覧性を高めることができます。
- **API不要**: ブラウザの表示データを利用するため、API制限を気にせず利用可能。
- **ローカル完結**: 取得したログはすべてブラウザの内部ストレージ（LocalStorage）にのみ保存されます。外部サーバーへの送信は一切行われません。

## インストール方法
1. ブラウザに [Tampermonkey](https://www.tampermonkey.net/) などのユーザースクリプト管理拡張機能をインストールします。
2. 本リポジトリの `X-Timeline-Logger.user.js` をクリックします。
3. 画面右上の **[Raw]** ボタンを押すと、インストール画面が開くので「インストール」をクリックしてください。

## 使い方
- Xの画面左下に現れる青いアイコンをクリックするとログ画面が開きます。
- 設定（歯車アイコン）から保持件数などの調整が可能です。

---

## Overview
A browser utility (UserScript) that automatically captures tweets appearing on your X (Twitter) timeline and stores them in a temporary local list. It helps you keep track of interesting posts that might get lost while scrolling.

## Key Features
- **UI Optimized for Scannability**: Designed to present timeline info compactly, making it ideal for reviewing many posts in a short time.
- **Flexible Display Options**: Features timeline sorting, the ability to hide Reposts, and a toggle for image thumbnails, allowing you to maximize information density and focus purely on text.
- **No API required**: Extracts data directly from the DOM, unaffected by X's API rate limits.
- **Privacy First (Local Only)**: All captured logs are stored exclusively in your browser's LocalStorage. No data is ever sent to external servers.

## How to Install
1. Install a script manager like [Tampermonkey](https://www.tampermonkey.net/).
2. Navigate to `X-Timeline-Logger.user.js` in this repository.
3. Click the **[Raw]** button in the top right.
4. Click **"Install"** when the Tampermonkey tab opens.

## Usage
- Click the blue log icon at the bottom left of your X home screen to open the interface.
- Use the settings (gear icon) to manage the maximum log count and capture intervals.

---

## 免責事項 / Disclaimer
本ツールは私的なログ保持を補助する目的で作成されています。Xの利用規約を遵守して使用してください。
This tool is for personal logging assistance. Please use it in compliance with X's Terms of Service.

## License
MIT License
