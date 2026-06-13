# 🚕 需要ホットスポットマップ（県南中央交通圏）

埼玉県南部のタクシー乗務員向けWebアプリです。LINEリッチメニューからアクセスし、
「今日・今週どこに需要があるか」を地図上のピンで一目で確認できます。

- 地図：**Leaflet.js + OpenStreetMap（CARTO ダークタイル）** — APIキー不要・完全無料
- データ：`data/events.json`（GitHub Actions が毎日自動更新）
- ホスティング：**Vercel 無料枠**

---

## 画面構成

| エリア | 内容 |
| --- | --- |
| ヘッダー | 今日のサマリー（例「今日は3件のイベントあり」）＋最終更新時刻 |
| 天気バナー | ☔ 雨・雪の予報を「需要増のサイン」として表示（Open-Meteo・無料・キー不要） |
| ごとおびバナー | 5・10・15・20・25日・月末／給料日に「繁華街需要増」を表示 |
| 最寄りスポット | 現在地から最も近い需要スポットと距離を表示し、ワンタップでナビ起動 |
| マップ（約55%） | 需要スポットを色付きピンで表示。タップで吹き出し＋「ここへ向かう」ボタン |
| 凡例 | 🔴 大需要 / 🟡 中需要 / 🟢 小・参考 |
| 稼ぎどきタイムライン | 今日のイベントを終了時刻順に横スクロール表示。次にどこへ動くか一目 |
| イベント一覧 | 今日〜7日以内を日付順表示。距離・ナビ付き。過去はグレーアウト |

ピンの色は `demand_level` に対応します：
`high` → 🔴赤、`medium` → 🟡黄、`low` → 🟢緑。

### 売上アップ向け機能（すべて無料・APIキー不要）

1. **天気連動** — `components/WeatherBanner.tsx`。Open-Meteo の無料予報APIをブラウザから取得し、雨・雪・降水0.3mm以上になる時刻を「需要増の可能性」として表示。取得失敗時は何も出さず本体に影響なし。
2. **現在地 → 最寄りスポット ＋ ナビ** — ブラウザの位置情報（無料）で最寄りの需要スポットを算出。地図・一覧・タイムラインの各所に「ここへ向かう」ボタンを設置し、タップで Google マップのナビ（`maps/dir`）が起動。空車回送の削減に直結。
3. **稼ぎどきタイムライン** — `components/EarningsTimeline.tsx`。今日のイベントを終了時刻順に並べ、解散の波に先回りできるよう可視化。
4. **ごとおび／給料日バナー** — `lib/utils.ts` の `gotoubiInfo()`。カレンダー計算のみ（データ費0円）で、需要が増えやすい日を自動表示。

> 位置情報・ナビは **HTTPS でのみ動作**します。Vercel の公開URL（https）では問題なく動作し、ローカルの `http://localhost` も例外的に許可されます。

---

## ローカルでの起動

```bash
npm install
npm run dev
```

ブラウザで http://localhost:3000 を開きます。
（`data/events.json` のサンプルデータでピンが表示されます）

ビルド確認：

```bash
npm run build && npm run start
```

---

## ディレクトリ構成

```
/
├── app/
│   ├── page.tsx          # events.json を読み込みメイン画面を描画
│   ├── layout.tsx        # メタ情報・Leaflet CSS 読み込み
│   └── globals.css       # ダークテーマ・マーカー・ポップアップ装飾
├── components/
│   ├── HotspotApp.tsx    # 状態管理（選択ピン）・ヘッダー・凡例
│   ├── MapView.tsx       # Leaflet マップ（SSR無効でクライアント描画）
│   └── EventList.tsx     # 下部イベント一覧
├── lib/
│   ├── types.ts          # 型定義
│   └── utils.ts          # 日付フィルタ・整形ユーティリティ（JST基準）
├── data/
│   └── events.json       # イベントデータ（GitHub Actions が自動更新）
├── scripts/
│   ├── scrape_events.py  # イベント収集スクリプト（Python）
│   └── requirements.txt
├── .github/workflows/
│   └── update_events.yml # 毎日 05:00 JST に自動実行
├── vercel.json
└── README.md
```

---

## events.json のスキーマ

```jsonc
{
  "updated_at": "2026-06-13T05:00:00+09:00",
  "events": [
    {
      "id": "sample-1",
      "title": "戸田橋花火大会",
      "date": "2026-06-13",          // YYYY-MM-DD（必須）
      "time_start": "19:00",          // 任意
      "time_end": "20:30",            // 任意
      "venue": "荒川河川敷（戸田市）",
      "lat": 35.8009,                 // 緯度（必須）
      "lng": 139.6792,                // 経度（必須）
      "category": "花火",
      "demand_level": "high",         // high | medium | low
      "demand_comment": "終了直後に駅周辺で大量需要。早めの待機推奨。",
      "source_url": "https://..."
    }
  ]
}
```

### 手動でイベントを追加・固定したい場合

`id` を **`manual-` で始める**と、スクレイパーが上書き・削除しません。
（サンプルデータの `sample-` も同様に保持されます）

---

## データ自動更新の仕組み

1. `.github/workflows/update_events.yml` が **毎日 05:00 JST（20:00 UTC）** に起動
   （`workflow_dispatch` で手動実行も可能）
2. `scripts/scrape_events.py` が以下を収集し、住所を geopy + Nominatim で緯度経度へ変換
   - じゃらんnet イベント（埼玉県）
   - さいたま市観光国際協会
   - 埼玉県観光情報
3. `data/events.json` が変化していれば auto-commit して `main` へ push
4. push をトリガーに **Vercel が自動で再デプロイ** → 最新データが反映

> エラーの出たサイトはスキップし、取得できた分だけ更新します。
> サイトのHTML構造変更でセレクタが合わなくなった場合は `scrape_events.py` の
> `scrape_*` 関数内のCSSセレクタを調整してください。

### ローカルでスクレイパーを試す

```bash
pip install -r scripts/requirements.txt
python scripts/scrape_events.py
```

---

## Vercel へのデプロイ手順

### 1. GitHub リポジトリを作成して push

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/<リポジトリ名>.git
git push -u origin main
```

### 2. Vercel にインポート

1. https://vercel.com/ にGitHubアカウントでログイン
2. **「Add New…」→「Project」** をクリック
3. 上記のリポジトリを選択して **「Import」**
4. Framework Preset が **Next.js** になっていることを確認（自動検出されます）
5. 環境変数は **不要**（APIキーなし構成）
6. **「Deploy」** をクリック

数十秒でビルドが完了し、`https://<プロジェクト名>.vercel.app` が発行されます。
以後、`main` ブランチへ push するたびに自動で再デプロイされます。

### 3. GitHub Actions の書き込み権限を確認

auto-commit が動くよう、リポジトリの
**Settings → Actions → General → Workflow permissions** で
**「Read and write permissions」** を有効にしてください
（ワークフロー側でも `permissions: contents: write` を指定済み）。

---

## LINE リッチメニューへの設定方法

公開された Vercel の URL（例：`https://taxi-hotspot.vercel.app`）を
LINE公式アカウントのリッチメニューに紐付けます。

### LINE Official Account Manager で設定する場合

1. https://manager.line.biz/ にログインし、対象の公式アカウントを選択
2. 左メニュー **「トークルーム管理」→「リッチメニュー」** を開く
3. **「作成」** をクリック
4. **表示設定**
   - タイトル：例「需要マップ」
   - 表示期間：常時など任意
5. **コンテンツ設定**
   - テンプレートを選択（1ボタンの大きいものが押しやすい）
   - 画像を設定（「需要マップを開く」などのボタン画像）
6. 設定したタップ領域のアクションで **「リンク」** を選び、
   URL に Vercel の公開URLを入力
   - 例：`https://taxi-hotspot.vercel.app`
7. **「保存」** → リッチメニューを **「表示」** に切り替え

これで、乗務員がLINEのリッチメニューをタップするとアプリが開きます。

> **補足**：LINE内ブラウザ（LIFFではない通常のリンク）で開きます。
> 外部ブラウザで開かせたい場合は、リッチメニューのリンク先を
> そのままのURLにしておけば、利用者が「ブラウザで開く」を選択できます。

### Messaging API（リッチメニューAPI）で設定する場合

`richMenuId` を発行し、URIアクションに公開URLを設定します。
詳細は LINE Developers のドキュメントを参照してください：
https://developers.line.biz/ja/docs/messaging-api/using-rich-menus/

---

## カスタマイズのヒント

- **地図の初期中心・ズーム**：`components/MapView.tsx` の `DEFAULT_CENTER` / `DEFAULT_ZOOM`
- **表示日数**：`components/HotspotApp.tsx` の `upcomingEvents(data.events, 7)` の `7`
- **需要レベルの色**：`lib/utils.ts` の `DEMAND_COLOR` と `app/globals.css` の `.demand-marker`
- **タイル地図のデザイン**：`MapView.tsx` の `L.tileLayer(...)` のURL
  （明るいテーマにするなら CARTO の `light_all` などに変更）

---

## ライセンス / データ出典

- 地図タイル：© OpenStreetMap contributors © CARTO
- イベント情報：各収集元サイトに帰属します。商用利用時は各サイトの利用規約を確認してください。
