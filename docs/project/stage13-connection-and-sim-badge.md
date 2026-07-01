# 段階13f：接続状態と“架空(SIM)”の明示 — 状態を偽らない（R3 正直な表示の続き）— HTML/CSS＋純関数TDD＋smoke

> **ゴール**：画面で「今 **sim(未接続)** か **実機(USB/WiFi)** か」を常時分かるようにし、**未接続で開始したら“架空環境の動き”であることを明示**する。[stage13](stage13-measured-only-sensor-view.md)「嘘を描かない」の延長＝**状態も偽らない**。
> **なぜ（現状の小さな嘘）**：ヘッダの「SYSTEM ONLINE」＋脈動ドットは**常時点灯＝未接続でも“オンライン”に見える**。しかも sim の距離（架空の部屋へのレイキャスト）と実機の超音波実測が**同じソナー表示で見分けられない**。誤認防止のため状態を可視化する。
> **設計の肝**：状態→表示は**純関数 `linkStatusView`（Vitest）**に出す。DOM 反映（ヘッダ status／SIM バッジ）は smoke。**色の意味**：赤＝停止/危険**専用**／**琥珀＝sim（非live・実測でない）**／緑＝live 接続（[stage10](stage10-ui-layout-and-safety.md) の意味色に準拠）。**盛りすぎない**（インジケータ1＋バッジ1）。
> **前提**：[stage13](stage13-measured-only-sensor-view.md)（robot-centric sonar・`drawSonar`）。状態源は既存の `main` の **`connSource`（"sim"|"usb"|"wifi"）** と **`session.runner`（実機 runner の有無）**。**ロジック・sonar 描画は無改造**。
> **テストの性質**：純関数は unit、DOM 反映は smoke（目視）。
> **このstageの位置**：[stage12計画](stage12-improvement-plan.md) の **R3（表示の正直さ）**の続き。[stage13](stage13-measured-only-sensor-view.md) が「推定を描かない」なら、本書は「**sim/実機を偽らない**」。
> **編集はあなた**。括弧は半角。

---

## 0. この回の増分

| # | 増分 | ファイル | テスト |
|---|---|---|---|
| 1 | `linkStatusView`（接続種別→ラベル/トーン・純） | `app/src/ui/status.ts` | **先に**（vitest） |
| 2 | ヘッダを**実接続状態**に（常時点灯の「SYSTEM ONLINE」を廃止） | `index.html`／`style.css`／`main.ts` | smoke |
| 3 | **SIM バッジ**（未接続で開始→架空環境を明示） | `index.html`／`style.css`／`main.ts` | smoke |

> ロジック・`drawSonar`・保持IDは無改造。`main` は DOM を数行更新するだけ。

---

## 1. 設計方針

| 原則 | 具体策 |
|---|---|
| **状態の真実源を1つに** | 接続成功で `connSource=usb/wifi`（既存）／未接続・接続失敗は `sim`。ヘッダはこれを映すだけ。走行の有無は `session.runner`。 |
| **常時点灯をやめる（最大の誠実さ）** | 固定の「SYSTEM ONLINE」→ **実状態**（`SIM · 架空環境` / `LINK · USB` / `LINK · WiFi`）。ここが実質の嘘なので必ず直す。 |
| **色の意味を守る** | 赤＝**停止/危険専用**（状態表示に使わない）。**琥珀＝sim（非live）**、**緑＝live 接続**。既存パレット（`--gold`／`--cyan`）に沿う。 |
| **架空を走行時に明示** | 未接続で `開始` したら、ソナー画面に **`SIM · 架空環境（実測ではない）` バッジ**を出す＝「この動きは架空」と一目で分かる。 |
| **sim は“エラー”でなく既定の開発モード** | バッジ/表示は**中立な事実ラベル**のトーン（警告色＝赤は使わない。琥珀＝“非live”の意味）。 |
| **盛りすぎない** | ヘッダ状態1つ＋ビュー内バッジ1つに集約。feed ラベルの可変化（SIM↔LIVE）は**任意**（§5）。 |

---

## 2. 実装

### 2.1 増分1：`ui/status.ts`（純関数・テスト先行）

**① テスト（RED）** `app/src/ui/status.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { linkStatusView } from "./status";

describe("linkStatusView（接続種別→ヘッダ表示）", () => {
    it("sim=架空・tone sim", () => {
        expect(linkStatusView("sim")).toEqual({ label: "SIM · 架空環境", tone: "sim" });
    });
    it("usb=live", () => { expect(linkStatusView("usb")).toEqual({ label: "LINK · USB", tone: "live" }); });
    it("wifi=live", () => { expect(linkStatusView("wifi")).toEqual({ label: "LINK · WiFi", tone: "live" }); });
});
```

**② GREEN** `app/src/ui/status.ts`
```ts
// status.ts — 接続状態→ヘッダ表示(ラベル/トーン)を作る(純)。DOM/canvas は知らない＝単体テスト可。
// tone: sim=未接続(架空・非live) / live=USB or WiFi 接続。色分けは CSS(data-tone)で。
import type { TrajectoryHeader } from "../types";

export type LinkTone = "sim" | "live";

/** 接続種別→ヘッダの {ラベル, トーン}。sim=架空(未接続)、usb/wifi=live(接続)。 */
export function linkStatusView(source: TrajectoryHeader["source"]): { label: string; tone: LinkTone } {
    switch (source) {
        case "usb":  return { label: "LINK · USB",   tone: "live" };
        case "wifi": return { label: "LINK · WiFi",  tone: "live" };
        case "sim":  return { label: "SIM · 架空環境", tone: "sim" };
    }
}
```
→ vitest green（`switch` は `source` 全3種を網羅＝kind を増やすと tsc が指摘）。

### 2.2 増分2：ヘッダを実接続状態に

**`index.html`（status を可変に）**
```html
<!-- 旧: <div class="status"><span class="dot"></span> SYSTEM ONLINE</div> -->
<div class="status" id="link" data-tone="sim">
  <span class="dot" aria-hidden="true"></span> <span id="link-text">SIM · 架空環境</span>
</div>
```

**`src/style.css`（トーンの色。赤は使わない）**
```css
/* 接続トーン：既定=sim(琥珀・非live) / live=緑。赤は停止専用なので状態には使わない。 */
#link[data-tone="sim"]       { color: var(--gold); }
#link[data-tone="sim"]  .dot { background: var(--gold); box-shadow: 0 0 10px var(--gold); }
#link[data-tone="live"]      { color: #4be08a; }
#link[data-tone="live"] .dot { background: #4be08a; box-shadow: 0 0 10px #4be08a; }
```

**`main.ts`（DOM 反映＝smoke）**
```ts
import { linkStatusView } from "./ui/status";

const linkEl   = document.querySelector<HTMLElement>("#link")!;
const linkText = document.querySelector<HTMLElement>("#link-text")!;

function setLink(source: TrajectoryHeader["source"]): void {
    const v = linkStatusView(source);          // 純関数(テスト済)
    linkText.textContent = v.label;
    linkEl.dataset.tone = v.tone;              // CSS が data-tone で色分け
}

setLink("sim");                                // ★初期＝未接続(架空)

// connect() 成功時（既存 `connSource = source;` の直後）:
connSource = source;
setLink(source);                               // ★USB/WiFi 接続で live 表示に

// connect() 失敗時（catch 節）:
setLink("sim");                                // ★失敗＝未接続のまま(安全側)
```

### 2.3 増分3：SIM バッジ（未接続で開始→架空を明示）

**`index.html`（SIM feed にバッジ。`.feed` は既に position:relative）**
```html
<figure class="feed">
  <figcaption class="feed-label">SIM FEED // MAP</figcaption>
  <span class="feed-badge" id="sim-badge" hidden>SIM · 架空環境（実測ではない）</span>
  <canvas id="sim" width="640" height="480"></canvas>
</figure>
```

**`src/style.css`**
```css
/* 架空環境バッジ：ソナー画面の右上。琥珀=非live の意味（警告の赤ではない）。 */
.feed-badge {
  position: absolute; top: 10px; right: 12px; z-index: 2;
  padding: 3px 8px; border-radius: 2px;
  font-size: 0.6rem; letter-spacing: 0.18em; text-transform: uppercase;
  color: #1a1206; background: var(--gold);
}
```

**`main.ts`（`#start` で切替＝smoke）**
```ts
const simBadge = document.querySelector<HTMLElement>("#sim-badge")!;

// #start ハンドラ内（既存 isReal 判定を流用）:
const isReal = !!session.runner;
simBadge.hidden = isReal;                      // ★未接続(sim)で開始→バッジ表示 / 実機なら隠す
```
> 停止で消したいなら `emergencyStop()` 末尾で `simBadge.hidden = true` を足す（任意）。

---

## 3. 依存関係／フロー

```
接続成功  → connSource = usb/wifi → setLink(source)   ⇒ ヘッダ「LINK · USB/WiFi」緑
接続失敗/未 → connSource = sim      → setLink("sim")    ⇒ ヘッダ「SIM · 架空環境」琥珀
#開始     → isReal = !!session.runner → simBadge.hidden = isReal
             未接続なら ⇒ 画面右上に「SIM · 架空環境（実測ではない）」
```
- 純：`linkStatusView`（状態→表示。テスト済）。副作用：`setLink`/バッジ切替（DOM＝smoke）。
- `drawSonar`（stage13）・`connSource`/`session.runner`（既存）は**無改造**。main が DOM を数行更新するだけ。

---

## 4. テストは足りるか／DoD

| 観点 | 確認 |
|---|---|
| 状態→表示 | `linkStatusView`（sim/usb/wifi の label・tone）を unit 固定。 |
| DOM 反映 | smoke：起動時ヘッダ「**SIM · 架空環境**（琥珀）」／USB or WiFi 接続で「**LINK · …**（緑）」／接続失敗で SIM に戻る。 |
| 架空の明示 | smoke：**未接続で開始→ソナー右上に SIM バッジ**／実機接続で開始→バッジ出ない。 |
| 色の不変 | 赤は**停止専用**のまま（状態表示に赤を使っていない）。 |
| 無改造 | `drawSonar`・保持ID・sonar データ経路は変更なし。 |

- [ ] `npm run test:run`（`ui/status.test.ts` 含む）／`npm run typecheck` 緑。既存も緑。
- [ ] smoke：ヘッダが実状態を映す／未接続開始で「架空」バッジが出る／実機接続で live 表示・バッジ無し。

---

## 5. 据え置き／opinion
- **feed ラベルの可変化**（`SIM FEED`↔`LIVE FEED // 実測`）は任意。ヘッダ状態＋バッジで十分伝わるので、**重複を避け今回は入れない**（欲しければ `#sim` の `figcaption` も `setLink` で切替）。
- 一番の誠実さ改善は「**SYSTEM ONLINE 常時点灯の廃止**」。ここを実状態にするだけで「未接続なのに online に見える」嘘が消える。
- 将来 servo/IMU の実測フィードバックが入れば、sim/実機の区別に加え「指令 vs 実測」も同じ枠組みで明示できる（[stage13 §10](stage13-measured-only-sensor-view.md)）。

---
関連：[stage13](stage13-measured-only-sensor-view.md)（実測のみ・嘘を描かない）／ [stage10](stage10-ui-layout-and-safety.md)（HUD・色の意味）／ [stage12-improvement-plan.md](stage12-improvement-plan.md)（R3 正直な表示）／ [current-build-spec.md](../reference/current-build-spec.md)（sim=架空環境の位置づけ）
