# 段階10：操作UIのレイアウト／安全性改善（`index.html`・presentation＝smoke）

> **ゴール**：ボタンが小さく**押し間違えやすい**現状の `index.html` を、**Iron Man / JARVIS 風の HUD デザイン**＋**安全最優先**（特大の停止・危険操作の分離・大きいタップ領域）へ刷新する。**ロジックは無改造**（純粋に presentation。`main.ts`/`ui/`/`runner` 等は触らない）。
> **なぜ**：これは実機が**物理的に動く**操作盤。誤クリックで「開始」を踏むと暴走、緊急時に「停止」を押せないと危険。だが 7d の「記録の結線」とは別関心なので、**SRP に従い独立stage**にする（7d は実装済みで触らない）。
> **前提（不変条件・重要）**：`main.ts` は既存IDを**非null断定**で参照する（`document.querySelector("#save-ndjson")!`…）。**IDを1つでも消す/改名すると起動時に TypeError で throw し、以降の配線が全死**する（[7d](stage7d-recorder-and-ui.md) で実際に踏んだ罠）。**§3 のID一覧を全保持**すること。
> **このstageの位置**：[7d](stage7d-recorder-and-ui.md)（記録）／[8](stage8a-mjpeg-demux.md)（カメラ）／[9](stage9-main-single-responsibility.md)（main整理）とは**独立**。いつでも着手可。
> **テストの性質**：CSS/DOM/レイアウトは**ユニット不能＝目視 smoke**（[code-design §7](code-design.md)）。本stageに RED/GREEN は無い。
> **編集はあなた**。括弧は半角。

---

## 0. この回の増分

| # | 増分 | ファイル | テスト |
|---|---|---|---|
| 1 | スタイルシート新設（レイアウト＋安全UI） | `app/src/style.css` | smoke |
| 2 | 構造を刷新し CSS を `<link>` で読む | `app/index.html` | smoke（目視・全ボタン動作） |

> ロジック変更ゼロ。`app/src/*.ts` は無改造（CSS は `<link>` で読むので `main.ts` への `import` も不要＝presentation に閉じる）。HTML/CSS のみ。

---

## 1. 設計方針（HUD美学 × 安全UX）

**見た目**：Iron Man / JARVIS 風 HUD。暗背景＋シアン発光＋Starkゴールドのアクセント、角を斜めに切ったパネル（`clip-path`）、映像のターゲティング枠（コーナーブラケット）、走査線・グリッド、アークリアクター風の発光リング。フォントは等幅＋大文字＋字間で「テック」感（外部Web font 不要。Orbitron 等を足せば更に強化可）。
**安全は犠牲にしない**：派手でも停止が最も目立ち、危険操作は分離する。

| 原則 | 具体策 |
|---|---|
| **停止を最優先に** | `■ 停止 / ABORT` を**最大・赤・脈動発光**で最上段。HUD でも一番目立つ。Esc/Space 併用は既存のまま。 |
| **危険操作を分離** | 順序 **停止(赤) → 接続(シアン) → 走行/開始(ゴールド ENGAGE) → 記録(減光)**。開始を停止から離す。 |
| **意味色** | 停止=レッド警告／開始=Stark ゴールド／接続=HUD シアン／保存=減光ゴースト。色で役割が一目。 |
| **大きいタップ領域** | 全ボタン min-height 48px（停止92px・開始58px）。`clip-path` は見た目だけで当たり判定は矩形。 |
| **可読性** | シアン/白文字を暗背景に＝高コントラスト。走査線・グリッドは低 opacity＋`pointer-events:none`。 |
| **動きは控えめ＆配慮** | 脈動/点滅は軽く、`prefers-reduced-motion` で停止。装飾は全て `pointer-events:none`／`aria-hidden`。 |
| **既存IDを壊さない** | `main.ts` が参照する全ID（§3）を保持＝起動時 throw を防ぐ。 |
| **依存ゼロ** | CSS のみ（外部フォント/ライブラリ無し）。`canvas` を暗背景にして地図がHUDっぽく映える。 |

---

## 2. 全文（CSSは外部ファイルへ分離）

スタイルは `app/src/style.css` に切り出し、`index.html` から `<link>` で読む（Vite が `/src/style.css` を解決・バンドル）。**JS は無改造**（`main.ts` への `import` は使わず HTML の `<link>` だけ）。

### 2.1 `app/index.html`
```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>掃除ユニット 制御システム</title>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <!-- 装飾レイヤ（pointer-events:none でクリックは通す） -->
    <div class="hud-grid" aria-hidden="true"></div>
    <div class="scanlines" aria-hidden="true"></div>

    <header class="topbar">
      <div class="brand">
        <span class="reactor" aria-hidden="true"></span>
        <div>
          <h1>掃除ユニット 制御システム</h1>
          <p class="sub">CLEANING UNIT // CONTROL CONSOLE</p>
        </div>
      </div>
      <div class="status"><span class="dot" aria-hidden="true"></span> SYSTEM ONLINE</div>
    </header>

    <main class="layout">
      <!-- 映像フィード：シムの2Dマップ＋（WiFi時）カメラ -->
      <section class="stage">
        <figure class="feed">
          <figcaption class="feed-label">SIM FEED // MAP</figcaption>
          <canvas id="sim" width="600" height="450"></canvas>
        </figure>
        <figure class="feed">
          <figcaption class="feed-label">CAM FEED // WiFi</figcaption>
          <img id="cam" alt="カメラ映像（WiFi接続時に表示）" />
        </figure>
      </section>

      <!-- 操作コンソール：停止を最上段・特大。危険操作（開始）は分離 -->
      <aside class="console">
        <button id="stop" class="btn btn-stop">■ 停止<small>ABORT</small></button>
        <p class="hint">Esc / Space でも停止できます</p>

        <fieldset class="module">
          <legend>接続 // LINK</legend>
          <button id="connect" class="btn">実機接続（USB）</button>
          <button id="connect-wifi" class="btn">WiFi接続</button>
        </fieldset>

        <fieldset class="module">
          <legend>走行 // RUN</legend>
          <button id="start" class="btn btn-start">▶ 開始<small>ENGAGE</small></button>
          <p class="hint">未接続=sim / 接続済=実機</p>
        </fieldset>

        <fieldset class="module">
          <legend>記録 // LOG</legend>
          <button id="save-ndjson" class="btn btn-ghost">NDJSON 保存</button>
          <button id="save-csv" class="btn btn-ghost">CSV 保存</button>
        </fieldset>
      </aside>
    </main>

    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

### 2.2 `app/src/style.css`
```css
:root {
  --bg: #05080d;
  --panel: rgba(12, 20, 30, 0.55);
  --line: rgba(53, 224, 255, 0.25);
  --cyan: #35e0ff;
  --gold: #ffb454;
  --stop: #ff3b30;
  --ink: #d7f1ff;
  --muted: #6f93a6;
  --glow: 0 0 18px rgba(53, 224, 255, 0.35);
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; color: var(--ink); overflow-x: hidden; letter-spacing: 0.02em;
  font: 14px/1.5 ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
  background:
    radial-gradient(1200px 600px at 72% -10%, rgba(53, 224, 255, 0.10), transparent 60%),
    radial-gradient(900px 520px at 8% 115%, rgba(255, 180, 84, 0.06), transparent 60%),
    var(--bg);
}
/* 装飾レイヤ（クリックは通す） */
.hud-grid, .scanlines { position: fixed; inset: 0; pointer-events: none; }
.hud-grid {
  z-index: 0; opacity: 0.35;
  background:
    linear-gradient(rgba(53, 224, 255, 0.06) 1px, transparent 1px) 0 0 / 42px 42px,
    linear-gradient(90deg, rgba(53, 224, 255, 0.06) 1px, transparent 1px) 0 0 / 42px 42px;
  -webkit-mask-image: radial-gradient(circle at 50% 35%, #000, transparent 85%);
          mask-image: radial-gradient(circle at 50% 35%, #000, transparent 85%);
}
.scanlines {
  z-index: 60; opacity: 0.25;
  background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.35) 0 1px, transparent 1px 3px);
}
/* ヘッダ */
.topbar, .layout { position: relative; z-index: 1; }
.topbar {
  display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;
  padding: 16px 24px; border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(53, 224, 255, 0.05), transparent);
}
.brand { display: flex; gap: 14px; align-items: center; }
h1 {
  margin: 0; font-size: 1.05rem; letter-spacing: 0.18em; text-transform: uppercase;
  color: #eafaff; text-shadow: var(--glow);
}
.sub { margin: 3px 0 0; font-size: 0.66rem; letter-spacing: 0.3em; color: var(--muted); }
.status {
  display: flex; align-items: center; gap: 8px;
  font-size: 0.7rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--cyan);
}
.status .dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--cyan);
  box-shadow: 0 0 10px var(--cyan); animation: pulse 1.8s infinite;
}
/* アークリアクター風 */
.reactor {
  width: 34px; height: 34px; border-radius: 50%; flex: none; position: relative;
  border: 2px solid var(--cyan); box-shadow: var(--glow), inset 0 0 10px rgba(53, 224, 255, 0.5);
}
.reactor::before { content: ""; position: absolute; inset: 6px; border-radius: 50%; border: 1px solid rgba(53, 224, 255, 0.6); }
.reactor::after  { content: ""; position: absolute; inset: 12px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 12px var(--cyan); }
/* レイアウト */
.layout { display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; padding: 22px 24px 36px; }
.stage { flex: 1 1 480px; min-width: 320px; display: flex; flex-direction: column; gap: 18px; }
/* 映像フレーム（ターゲティング枠＝コーナーブラケット。clip-path は付けない） */
.feed { position: relative; margin: 0; padding: 14px; background: var(--panel); border: 1px solid var(--line); }
.feed::before, .feed::after { content: ""; position: absolute; width: 18px; height: 18px; border: 2px solid var(--cyan); opacity: 0.85; }
.feed::before { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
.feed::after  { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }
.feed-label { margin: 0 0 8px; font-size: 0.66rem; letter-spacing: 0.28em; text-transform: uppercase; color: var(--cyan); }
#sim { width: 100%; height: auto; max-width: 600px; display: block; background: #060a10; border: 1px solid var(--line); }
#cam { width: 100%; max-width: 360px; min-height: 64px; display: block; background: #060a10; border: 1px solid var(--line); }
/* コンソール */
.console { flex: 0 0 300px; display: flex; flex-direction: column; gap: 16px; }
.module {
  position: relative; margin: 0; padding: 14px; background: var(--panel); border: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 10px;
  clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px));
}
.module > legend { padding: 0 8px; font-size: 0.64rem; letter-spacing: 0.26em; text-transform: uppercase; color: var(--cyan); }
/* ボタン（角を斜めに切る＝HUD。当たり判定は矩形） */
.btn {
  position: relative; width: 100%; min-height: 48px; padding: 12px 16px; cursor: pointer;
  font: inherit; font-weight: 700; font-size: 0.84rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink);
  background: linear-gradient(180deg, rgba(53, 224, 255, 0.10), rgba(53, 224, 255, 0.02));
  border: 1px solid var(--line);
  clip-path: polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 9px 100%, 0 calc(100% - 9px));
  transition: box-shadow 0.15s, border-color 0.15s, color 0.15s, transform 0.05s;
}
.btn:hover { color: #eafaff; border-color: var(--cyan); box-shadow: var(--glow), inset 0 0 16px rgba(53, 224, 255, 0.12); }
.btn:active { transform: translateY(1px); }
.btn:focus-visible { outline: 2px solid var(--cyan); outline-offset: 3px; }
.btn small { display: block; margin-top: 3px; font-size: 0.58rem; letter-spacing: 0.32em; color: var(--muted); }
/* 緊急停止：最大・赤・脈動 */
.btn-stop {
  min-height: 92px; font-size: 1.25rem; font-weight: 800; letter-spacing: 0.2em; color: #fff;
  background: radial-gradient(120% 120% at 50% 0%, rgba(255, 59, 48, 0.35), rgba(255, 59, 48, 0.10));
  border: 1px solid rgba(255, 59, 48, 0.7);
  box-shadow: 0 0 24px rgba(255, 59, 48, 0.3), inset 0 0 22px rgba(255, 59, 48, 0.16);
  animation: stopPulse 2s infinite;
}
.btn-stop small { color: #ffd2cf; }
.btn-stop:hover { border-color: #ff3b30; box-shadow: 0 0 34px rgba(255, 59, 48, 0.6), inset 0 0 26px rgba(255, 59, 48, 0.28); }
/* 開始：Stark ゴールド ENGAGE */
.btn-start {
  min-height: 58px; font-size: 1rem; color: #1a1206;
  background: linear-gradient(180deg, var(--gold), #e8961f);
  border: 1px solid rgba(255, 180, 84, 0.85); box-shadow: 0 0 18px rgba(255, 180, 84, 0.3);
}
.btn-start small { color: #5a3a00; }
.btn-start:hover { filter: brightness(1.06); box-shadow: 0 0 26px rgba(255, 180, 84, 0.55); }
/* 保存：減光ゴースト */
.btn-ghost { background: transparent; color: var(--muted); }
.btn-ghost:hover { color: var(--cyan); }
.hint { margin: 2px 2px 0; font-size: 0.66rem; letter-spacing: 0.06em; color: var(--muted); }
/* アニメ（reduced-motion で停止） */
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes stopPulse {
  0%, 100% { box-shadow: 0 0 24px rgba(255, 59, 48, 0.3), inset 0 0 22px rgba(255, 59, 48, 0.16); }
  50%      { box-shadow: 0 0 38px rgba(255, 59, 48, 0.6), inset 0 0 28px rgba(255, 59, 48, 0.3); }
}
@media (max-width: 760px) { .console { flex: 1 1 100%; } }
@media (prefers-reduced-motion: reduce) {
  .status .dot, .btn-stop { animation: none; }
}
```

> **canvas の `width="600" height="450"` 属性は必須**（描画バッファ＝座標系の実寸。`ui/draw.ts` が `canvas.width/height` でスケール計算する）。CSS の `width:100%` は**表示サイズだけ**を伸縮し、`height:auto` で 4:3 を保つ。属性を消すとバッファが既定 300×150 になり描画が崩れる。

---

## 3. 保持すべきID（`main.ts` が非null参照＝消すと起動時 throw）

| ID | `main.ts` の参照 | 用途 |
|---|---|---|
| `#sim` | `:27` canvas 取得 | 描画 |
| `#stop` | `:113` | 緊急停止 |
| `#start` | `:107` | 開始 |
| `#connect` | `:140` | USB接続 |
| `#connect-wifi` | `:141` | WiFi接続 |
| `#save-ndjson` | `:121` | NDJSON保存 |
| `#save-csv` | `:131` | CSV保存 |
| `#cam` | WiFi接続成功時 `cam.src` | カメラ表示 |

> 不変条件：**この8つのIDは改名・削除しない**。`querySelector(...)!` が `null` になると `.addEventListener` で throw し、画面全体が動かなくなる（7d の §6 で踏んだ罠）。本stageは**見た目だけ**を変え、IDとイベント配線はそのまま。

---

## 4. Definition of Done（smoke・目視）
- [ ] `npm run dev` で開き、**`/src/style.css` が読み込まれ**スタイルが当たる（無スタイルの素のHTMLでない）。`npm run build` でも CSS がバンドルされる。
- [ ] **8ボタン全部がクリックで反応**（開始/停止/USB/WiFi/NDJSON/CSV）＝ID欠落なし。
- [ ] `npm run typecheck` 緑（HTML変更のみなので影響無いはずだが、念のため）。既存テストも緑のまま（ロジック無改造）。
- [ ] **停止が最も目立つ**（特大・赤・脈動発光・最上段）／開始（ゴールド）と停止が離れている。
- [ ] 暗背景でも全ラベルが読める（コントラスト十分）。OS の「視差効果を減らす」で**脈動/点滅が止まる**（`prefers-reduced-motion`）。
- [ ] 画面幅を縮めてもレイアウトが崩れず、パネルが canvas の下へ回り込む。
- [ ] sim 描画・軌跡トレイル・カメラ表示（WiFi時）が従来どおり出る（描画ロジック無改造）。

---
関連：[stage7d](stage7d-recorder-and-ui.md)（保存ボタン/記録配線・参照IDの発生源）／ [code-design.md](code-design.md)（§7 副作用は smoke・§3 `ui/draw.ts` は描画だけ）／ [stage5-wireless-camera.md](stage5-wireless-camera.md)（`#cam`）
