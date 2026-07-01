# 段階10b：操作UIをレスポンシブに — 安全（STOP到達性）を全幅で維持（CSS・smoke）

> **ゴール**：`index.html`＋`style.css` を**スマホ〜4Kまで崩れない**レスポンシブにする。ただし [stage10](stage10-ui-layout-and-safety.md) の最優先原則「**停止が最も目立ち、常に最短で押せる**」を**どの画面幅でも守る**。
> **なぜ（安全の穴）**：現状は狭幅で `.stage`（map）が上・`.console`（操作）が下へ回り込む＝**緊急停止が“下スクロール”しないと押せない**。ロボット操作盤では致命的。レスポンシブ化＝この穴を塞ぐこと。
> **設計の肝**：(1) **モバイルでは操作(`.console`)を最上部へ並べ替え**（`order:-1`）＝STOP が画面先頭で**スクロール不要で即押せる**。STOP は**通常フローのまま**（fixed/sticky にしない）＝他ボタンと**原理的に重ならない**。(2) 余白/文字は **`clamp()` で流体**化して段差を減らす。(3) `.stage` の `min-width` 起因の**横溢れを修正**。**HTML は無改造**＝CSS のみ。
> **前提**：[stage10](stage10-ui-layout-and-safety.md)（HUD・安全UX・保持すべきID）／[stage13](stage13-measured-only-sensor-view.md)（**現行の canvas は 480×480 正方形**の robot-centric sonar。`index.html` の `<canvas 480×480>` と `#sim { aspect-ratio:1/1; max-width:480px }` は stage13 が確定済み＝**これを前提にレスポンシブ化**する）。ロジック・`ui/`・`main` は無改造。
> **注意（既存の HTML/CSS を壊さない）**：stage13 が `#sim` を「正方形・robot 中心 sonar」に変更済み（旧 stage11 の 4:3 タクティカルマップ `draw.ts` は撤去）。本stageは **`#sim` の `width`/`aspect-ratio`/`max-width` を据え置き**、`max-height` 等を**足すだけ**。sonar 描画（`ui/sonar-view`）・保持IDには触れない。
> **テストの性質**：CSS/レイアウトは**ユニット不能＝目視 smoke**（複数幅で確認）。
> **このstageの位置**：[stage10](stage10-ui-layout-and-safety.md)（レイアウト/安全）の続き。
> **編集はあなた**。括弧は半角。

---

## 0. この回の増分

| # | 増分 | ファイル | テスト |
|---|---|---|---|
| 1 | 流体スペーシング／横溢れ修正／landscape 対策 | `app/src/style.css` | smoke |
| 2 | ブレークポイント（≤760 / ≤480 / ≥1400）＋**モバイルで操作を上へ並べ替え（STOP 先頭）** | `app/src/style.css` | smoke（目視・全幅で STOP 到達・重なり無し） |

> **HTML 変更は1箇所のみ**：`<canvas>` の buffer を `480×480`→**`640×480`（4:3）**に（下記②。歪み防止のため CSS の `aspect-ratio` と揃える）。ロジック・描画は無改造。

> **改訂（実機フィードバック反映）**：① sim window を**正方形→長方形(4:3)**にして frame をぴったり埋める（`.stage max-width:760`＋`#sim aspect-ratio:4/3`＋canvas buffer 640×480）。② 狭幅は**自然順＝map が上・操作(STOP含む)は下段**へ（`order:-1` 撤去）。※以前の「console を最上部へ」「canvas は正方形」方針はこの2点で置換。以下の §1/§2/§3 の該当記述はこの改訂後の内容。STOP はそれでも `Esc/Space` 常時可＋map が 4:3 で高さ制限され下段でも近い。

---

## 1. 設計方針

| 原則 | 具体策 |
|---|---|
| **安全＝STOP到達性を全幅で維持（最優先）** | 狭幅では **`.console` を最上部へ並べ替え**（`order:-1`）＝STOP が画面先頭・**スクロール不要で即押せる**。STOP は通常フローのまま（fixed/sticky にしない）＝**他ボタンと絶対に重ならない**。map(sonar) は `max-height` で高さ制限済みなので下でも可。 |
| **流体スペーシング** | `.layout`/`.topbar` の padding・gap を **`clamp()`** に。ブレークポイントの段差を減らし、320〜1440px を滑らかに。 |
| **横溢れ修正** | `.stage { min-width: 320px → 0 }`。320px 幅の端末で `min-width:320px`＋padding が**横スクロールを生む**穴を根本修正（`overflow-x:hidden` の“隠す”に頼らない）。 |
| **canvas の縦暴走を抑える** | 既存 `#sim`（stage13 の正方形 sonar）に `max-height` を**1行足すだけ**。横向きスマホで正方形ビューが**ビューポート高を超える**のを防ぐ（`aspect-ratio:1/1`・`max-width` は据え置き）。 |
| **ブレークポイント（最小限）** | base（2カラム）／`≤760`（1カラム・console を上へ）／`≤480`（余白・文字を詰める・副題省略）／`≥1400`（超ワイドは中央寄せ）。 |
| **タップ領域** | 既存 min-height 48px（停止は特大）を維持＝指で外しにくい。 |
| **美学・A11y・動き配慮を維持** | HUD 配色・グロー・`:focus-visible`・`prefers-reduced-motion` は据え置き。装飾は `pointer-events:none`／`aria-hidden` のまま。 |

> **なぜ「固定STOP」をやめたか（実装で判明）**：STOP を `position:fixed`（画面下部固定）にすると、`html,body{height:100%}` と相まって `body{padding-bottom}` の**余白予約が効かず、STOP が他ボタン（特に保存）に重なる**不具合が出た。加えて固定バーは本質的に「スクロール中の要素が裏を通る」＝重なって見える。よって **STOP を通常フローに戻し、`.console` を最上部へ並べ替える**方式に変更。STOP が画面先頭で即押せ、**重なりが原理的に起きない**。map(sonar) は `max-height:min(72vh,480px)` で高さ制限済みなので、下に置いても STOP は近い。

---

## 2. `app/src/style.css`（全文）

現状の `style.css` にレスポンシブ変更を統合した**完全版**。`★` が今回の変更点（`min-height:100dvh`／`clamp()` 流体化／`.stage min-width:0`／`#sim max-height`／末尾のブレークポイント3つ）。他は既存のまま。

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
  min-height: 100dvh;                              /* ★モバイルのブラウザchrome考慮 */
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
  padding: clamp(10px, 2.5vw, 16px) clamp(14px, 3vw, 24px);   /* ★流体（旧 16px 24px） */
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, rgba(53, 224, 255, 0.05), transparent);
}
.brand { display: flex; gap: 14px; align-items: center; }
h1 {
  margin: 0; font-size: clamp(0.92rem, 0.8rem + 0.6vw, 1.05rem);   /* ★流体（旧 1.05rem） */
  letter-spacing: 0.18em; text-transform: uppercase; color: #eafaff; text-shadow: var(--glow);
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
.layout {
  display: flex; flex-wrap: wrap; align-items: flex-start;
  gap: clamp(14px, 2.5vw, 22px);                              /* ★流体（旧 22px） */
  padding: clamp(14px, 3vw, 22px) clamp(14px, 3vw, 24px) clamp(24px, 5vw, 36px);   /* ★流体（旧 22px 24px 36px） */
}
.stage { flex: 1 1 480px; min-width: 0; max-width: 760px; display: flex; flex-direction: column; gap: 18px; }   /* ★frame を canvas に合わせ幅制限（右の空白を無くす）／min-width:0（横溢れ防止） */
/* 映像フレーム（ターゲティング枠＝コーナーブラケット。clip-path は付けない） */
.feed { position: relative; margin: 0; padding: 14px; background: var(--panel); border: 1px solid var(--line); }
.feed::before, .feed::after { content: ""; position: absolute; width: 18px; height: 18px; border: 2px solid var(--cyan); opacity: 0.85; }
.feed::before { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
.feed::after  { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }
.feed-label { margin: 0 0 8px; font-size: 0.66rem; letter-spacing: 0.28em; text-transform: uppercase; color: var(--cyan); }
/* canvas（長方形 4:3。frame 幅いっぱいに。※buffer も 640×480＝4:3 に：index.html） */
#sim {
  width: 100%; aspect-ratio: 4 / 3; height: auto; display: block;   /* ★正方形→長方形(4:3) */
  max-height: min(72vh, 540px);                                     /* ★横向き端末で縦に暴れない */
  background: #060a10; border: 1px solid var(--line);
}
/* カメラも frame 幅いっぱいに（大画面で小さいままにしない）。4:3 で SIM と揃える。 */
#cam {
  width: 100%; aspect-ratio: 4 / 3; height: auto; object-fit: contain; display: block;   /* ★max-width:360 撤去＝縮こまらない */
  max-height: min(60vh, 540px);
  background: #060a10; border: 1px solid var(--line);
}
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

/* ===== ★レスポンシブ（ブレークポイント） ===== */

/* タブレット〜スマホ：1カラムに積み、操作(console)を map の上へ。
   ※flex-direction は変えない。column にすると base の align-items:flex-start が“横方向”の制御になり、
     各要素が全幅に伸びず内容幅で左寄せ＝崩れる。flex-wrap + flex-basis:100% で全幅の別行に積む。 */
@media (max-width: 760px) {
  .console { flex: 1 1 100%; }                 /* ★自然順＝map/CAM が上・操作(STOP含む)は下段（order 撤去） */
  .stage { flex: 1 1 100%; max-width: none; }  /* map は全幅（PC用の上限を解除） */
}

/* 小型スマホ：余白と文字をさらに詰める */
@media (max-width: 480px) {
  .sub { display: none; }                          /* 副題を省きヘッダを軽く */
  .btn { font-size: 0.78rem; letter-spacing: 0.1em; }
  .feed { padding: 10px; }
  .module { padding: 12px; }
}

/* 超ワイド：中央寄せで console が sonar から離れすぎないように */
@media (min-width: 1400px) {
  .layout { max-width: 1360px; margin-inline: auto; }
}

/* 動き配慮 */
@media (prefers-reduced-motion: reduce) {
  .status .dot, .btn-stop { animation: none; }
}
```

> **注（固定STOPをやめた理由）**：当初 `.btn-stop { position:fixed; bottom }` ＋ `body{padding-bottom}` にしたが、`html,body{height:100%}` で**余白予約が効かず STOP が保存ボタン等に重なった**。通常フローのまま **`.console { order:-1 }` で操作を上へ**寄せる方式に変更＝STOP が先頭で即押せ、**重なりが起きない**。`.btn-stop` は base の見た目（92px・赤・脈動）のまま。**保持IDは stage10 のまま**（`#sim`/`#stop`/… を改名・削除しない）。

> **任意（ノッチ端末の見切れ対策）**：`index.html` の viewport に1語だけ追加してもよい。`index.html` の他は無改造。
> ```html
> <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
> ```

---

## 3. テストは足りるか／DoD（smoke・目視）

CSS はユニット不能。**代表4幅＋向き**で目視確認する。

- [ ] **360px（小型スマホ）**：横スクロールが出ない／**STOP が画面先頭**（操作が map の上）で押せる／**STOP が他ボタンに重ならない**／文字が溢れない。
- [ ] **768px（タブレット/縦）**：1カラム・操作が上・map と操作が破綻しない・重なり無し。
- [ ] **1024px（ノートPC）**：2カラム（sonar 左・console 右）で従来どおり。
- [ ] **1440px+（大画面）**：中央寄せで console が sonar から離れすぎない。
- [ ] **横向きスマホ（例 740×360）**：正方形ビューが縦に溢れず（`max-height`）、STOP が先頭で押せる。
- [ ] **不変**：HUD 配色・グロー・**sonar 描画（ray/ring/readout・stage13）**は従来どおり（CSS は canvas 内描画に触れない）。`prefers-reduced-motion` で脈動が止まる。
- [ ] **安全**：どの幅でも「開始→停止が最短で押せる」。**狭幅では STOP が先頭＝下スクロール不要**／**固定要素が他ボタンに被らない**。

---
関連：[stage10](stage10-ui-layout-and-safety.md)（HUD・安全UX・保持すべきID）／ [stage11](stage11-sim-tactical-map.md)（canvas の `aspect-ratio`）／ [code-design.md](code-design.md)（§7 副作用は smoke）
