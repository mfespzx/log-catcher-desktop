# Log Cacher Ticker Gadget

Log Cacher が出力した JSON から `kind === "TODO"` を拾い、
新幹線ドア上の電光掲示板っぽく 1 行ずつ横スクロール表示する Electron ガジェットです。

## 入っている機能

- 1 行テロップ表示（右 → 左）
- 1 件ずつ順番に表示
- `active` 優先、`done` は後ろ
- ホバーで一時停止
- ホイールで次/前の TODO へ手動送り
- クリックで元の ChatGPT ルームを開く
- JSON ファイル更新で自動再読込
- 右クリックメニューで設定変更
  - JSON を選ぶ
  - active のみ流す
  - done も含める
  - 速度 Slow / Normal / Fast
  - 常に手前
- トレイ常駐

## 使い方

```bash
npm install
npm start
```

起動後、ガジェット上で右クリックして **「JSON を選ぶ…」** を押し、
Log Cacher のエクスポート JSON を指定してください。

## 想定している JSON

以下のような形式を前提にしています。

- ルートに `logs` 配列がある
- `logs[].kind === "TODO"` を抽出する
- `selectionText` をテロップ本文に使う
- `pageTitle` / `dateOnly` / `status` / `url` を補助表示に使う

## 操作

- **クリック**: 現在表示中の TODO の元URLを開く
- **ホバー**: テロップ一時停止
- **ホイール**: 前後の TODO に切替
- **右クリック**: 設定メニュー
- **Ctrl+O**: JSON ファイル選択

## メモ

- `status` は `done` のときのみ完了扱いにし、それ以外は `active` として扱っています。
- 最初は読み取り専用です。JSON への書き戻しはしていません。
