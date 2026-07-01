# 段階13：実測データのみのセンサビュー（robot-centric・推定を描かない）— TDD

> **ゴール**：表示から**推定（位置・向き・軌跡）を排し、実測（距離）＋指令（首方向）だけ**で構成する **robot-centric なセンサビュー**にする。エンコーダ無し＝**位置は測れない → 積分しない → ドリフトしない → 嘘を描かない**。
> **なぜ**：位置(軌跡)は原理的に**推定でフィクション**（前回議論）。校正しても天井が低い。我々が本当に測っているのは**距離だけ**。ならば**実測を主役**にし、位置は描かない。
> **副産物（大きな簡素化）**：表示から **pose 推定が消える** → ①`SimConfig`/`motionModel` の**二重校正が表示に不要**（以前の「sim の値が2つ違う」問題が構造的に消滅）②**sim/実機の pose 分岐が消える**（距離は両方“実測”）③**trail のドリフトが消える**。
> **要件**：**R3（表示の正直さ＝「嘘を描かない」）の最終形**。位置推定の表示をやめ、実測だけを出す。R1（軌跡ログ）は別artifactとして温存（§8.1 Scope A）。
> **前提**：[stage6](stage6-scan-and-reverse.md)（scan/servo）／`nextServoDeg`（実装済・首方向の carry-forward を再利用）。robot 中心の投影/写像は**新規の純関数 `sonarLayout`/`sonarPointPx`/`fadeAlpha`**（§3.4）で持つ（stage11 の `polarPointCm`/`aimAngleDeg` は本ビューでは使わず、`draw.ts` と共に撤去＝§8.1）。
> **原則**：**描くのは「実測 or 指令」だけ**。**積分しない**（robot-centric＝ロボットは中心固定）。**純ロジックは全て単体テスト・canvas 呼び出しだけ smoke**（テスト内訳は §9）。tsc クリーンを実測確認済み。

---

## 1. 何が「実測」で何が「推定」か（描く／描かないの線引き）

| データ | 種別 | 表示 |
|---|---|---|
| **距離**（超音波 N=21） | **実測** ◎ | **描く**（ray・数値） |
| **離地**（N=23） | **実測** | 描く（GND/LIFTED） |
| 首の角度（servo） | **指令**（no feedback） | 描く（測定した方向として・「指令」明示） |
| 指令（forward/turn/…） | 指令（事実） | 描く（CMD） |
| **位置 (x,y)** | **推定**（指令の積分・ドリフト） | ❌ **描かない** |
| **向き (yaw)** | **推定**（同上） | ❌ **描かない** |
| **軌跡 (trail)** | **推定** | ❌ **描かない**（＝robot 中心なので不要） |

> **キモ**：距離は「1点の実測」で**積分しない**＝ドリフトしない・校正不要・嘘をつけない。位置/軌跡は「指令の積分」＝誤差が溜まる＝フィクション。だから前者だけ描く。

---

## 2. 設計：robot-centric sonar（積分しないセンサ盤）

- **ロボットは canvas 中心に固定・正面＝上**。世界の位置/向きは描かない（測れない）。
- 各 tick の **(首の指令方向, 実測距離)** を **`SonarSample`** にし、robot 相対角で **ray（＋終端のヒット点）** を描く。
- **scan 中は左/中/右の実測が同時に並ぶ＝“今この瞬間の局所マップ”**。走行中は前方 ray のみ。
- **距離リング**（実スケール・20cm毎）で「何cm先か」を読める。リードアウトは**実測のみ**（X/Y 無し）。
- 古い実測は時間で落とす（robot が向きを変えると相対も古くなるため。scan 中は静止なので3点は整合）。

---

## 3. Domain（純・TDD）

### 3.1 型（`types.ts`）
```ts
/** 実測の距離サンプル(robot 相対)。位置に積分しない=ドリフトしない。 */
export type SonarSample = {
    relDeg: number;      // ロボット正面からの相対方向[度](0=正面・反時計回りが+)。首の「指令」方向
    distanceCm: number;  // 超音波の「実測」距離[cm](>0)
    t: number;           // 実測時刻[ms]
};
```

### 3.2 `sensing/sonar.ts`（実測→サンプル・古い測定の間引き）

**① テスト（RED）** `app/src/sensing/sonar.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { toSonarSample, pruneSonar } from "./sonar";
import type { SonarSample } from "../types";

describe("toSonarSample（実測距離+指令方向。無効は null）", () => {
    it("有効: relDeg=servo-forward・距離はそのまま", () => {
        expect(toSonarSample(150, 90, 48, 100, 150)).toEqual({ relDeg: 60, distanceCm: 48, t: 100 });
        expect(toSonarSample(30, 90, 20, 5, 150)).toEqual({ relDeg: -60, distanceCm: 20, t: 5 });
    });
    it("エコー無し(0)は null(捏造しない)", () => { expect(toSonarSample(90, 90, 0, 100, 150)).toBeNull(); });
    it("範囲外(>maxCm)は null", () => { expect(toSonarSample(90, 90, 200, 100, 150)).toBeNull(); });
});

describe("pruneSonar（積分しない=直近だけ残す）", () => {
    const s = (t: number): SonarSample => ({ relDeg: 0, distanceCm: 30, t });
    it("windowMs 内は残し、古いものは落とす", () => {
        expect(pruneSonar([s(0), s(500), s(1000)], 1200, 1000).map((x) => x.t)).toEqual([500, 1000]);
    });
    it("境界(ちょうど windowMs)は残す", () => { expect(pruneSonar([s(200)], 1200, 1000).length).toBe(1); });
});
```

**② GREEN** `app/src/sensing/sonar.ts`
```ts
// sonar.ts — 実測距離を robot 中心のサンプルにする(純)。位置に積分しない=ドリフトしない・嘘を描かない。
import type { SonarSample } from "../types";

/** tick の実測から robot 相対サンプルを作る。エコー無し(0)/範囲外は null(=実測が無い=描かない)。
 *  距離は実測、方向は首の指令(servoDeg・no feedback)。 */
export function toSonarSample(
    servoDeg: number, servoForwardDeg: number, distanceCm: number, t: number, maxCm: number,
): SonarSample | null {
    if (distanceCm <= 0 || distanceCm > maxCm) return null;   // 0=エコー無し/範囲外は捨てる(捏造しない)
    return { relDeg: servoDeg - servoForwardDeg, distanceCm, t };
}

/** 直近 windowMs の実測だけ残す(古い測定は落とす。世界座標に積分しない)。 */
export function pruneSonar(samples: SonarSample[], nowT: number, windowMs: number): SonarSample[] {
    return samples.filter((s) => nowT - s.t <= windowMs);
}
```

### 3.3 `ui/readout.ts` に `formatSensorReadout`（実測のみ・X/Y 無し）

**① テスト（RED）** `app/src/ui/readout-sensor.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { formatSensorReadout } from "./readout";

describe("formatSensorReadout（実測のみ・推定X/Yを出さない）", () => {
    it("距離/首角(指令)/離地/指令を出す", () => {
        expect(formatSensorReadout(48, 90, 90, false, "forward")).toBe("DIST 48cm  AIM +0°  GND  CMD forward");
    });
    it("エコー無し(0)は DIST --", () => {
        expect(formatSensorReadout(0, 90, 90, false, "stop")).toBe("DIST --  AIM +0°  GND  CMD stop");
    });
    it("首の指令方向で AIM 符号 / 離地", () => {
        expect(formatSensorReadout(20, 30, 90, true, "rotateRight")).toBe("DIST 20cm  AIM -60°  LIFTED  CMD rotateRight");
    });
});
```
**② GREEN** `app/src/ui/readout.ts`（追記）
```ts
/** 実測のみのリードアウト(推定 X/Y は出さない)。distance 0=エコー無しは "--"。 */
export function formatSensorReadout(
    distanceCm: number, servoDeg: number, servoForwardDeg: number, lifted: boolean, cmdKind: import("../types").Command["kind"],
): string {
    const aim = Math.round(servoDeg - servoForwardDeg);
    const dist = distanceCm > 0 ? `${Math.round(distanceCm)}cm` : "--";
    return `DIST ${dist}  AIM ${aim >= 0 ? "+" : ""}${aim}°  ${lifted ? "LIFTED" : "GND"}  CMD ${cmdKind}`;
}
```
→ この時点で vitest **8/8**（sonar 5＋readout 3）／`tsc` クリーン（実測。§3.4 で geometry 分を追加）。**既存 `formatReadout`（X/Y入り）は撤去**（推定表示専用・本ビューでは使わない。削除の段取りは §8.1）。

### 3.4 `ui/geometry.ts` に純関数を追加（幾何 `sonarLayout`/`sonarPointPx` ＋ 写像 `fadeAlpha`）

> **なぜ純関数に出すか**：sonar の「角度→画面座標」「スケール」「古さ→不透明度」は**バグの温床（符号・y反転・クランプ漏れ）**。`draw.ts` が投影を `ui/geometry`（`scaleFor`/`toPx`）へ出してテストしているのと同じく、**canvas 層に inline せず抽出してテスト**する（当初案は inline で SRP/TDD 不足だった＝本改訂で是正。※`fadeAlpha` は幾何ではないが「ui の純写像」として `normalizeYaw` 同様 geometry に置く）。

**① テスト（RED）** `app/src/ui/sonar-geometry.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { sonarLayout, sonarPointPx, fadeAlpha } from "./geometry";

describe("sonarLayout（canvas→中心/スケール）", () => {
    it("中心=canvas/2・scale=(min半径-余白)/maxRange", () => {
        expect(sonarLayout(500, 500, 150, 8)).toEqual({ cx: 250, cy: 250, scale: (250 - 16) / 150 });
        expect(sonarLayout(600, 400, 100, 0)).toEqual({ cx: 300, cy: 200, scale: 200 / 100 });  // 縦が制約
    });
});
describe("sonarPointPx（0=上・+左=反時計。符号バグ検出）", () => {
    const at = (relDeg: number) => sonarPointPx(relDeg, 50, 100, 100, 1);
    it("relDeg=0 → 真上", () => { const p = at(0); expect(p.px).toBeCloseTo(100); expect(p.py).toBeCloseTo(50); });
    it("relDeg=+90(左) → 真左", () => { const p = at(90); expect(p.px).toBeCloseTo(50); expect(p.py).toBeCloseTo(100); });
    it("relDeg=-90(右) → 真右", () => { const p = at(-90); expect(p.px).toBeCloseTo(150); expect(p.py).toBeCloseTo(100); });
});
describe("fadeAlpha（古さ→不透明度・新しいほど濃い）", () => {
    it("最新は最も濃い(min+span)", () => { expect(fadeAlpha(1000, 1000, 1500, 0.15, 0.85)).toBeCloseTo(1.0); });
    it("fadeMs 経過で最も薄い(min)", () => { expect(fadeAlpha(2500, 1000, 1500, 0.15, 0.85)).toBeCloseTo(0.15); });
    it("半分経過は中間", () => { expect(fadeAlpha(1750, 1000, 1500, 0.15, 0.85)).toBeCloseTo(0.575); });   // 0.15+0.85*0.5
    it("未来/超過はクランプ", () => { expect(fadeAlpha(500, 1000, 1500, 0.15, 0.85)).toBeCloseTo(1.0); });
});
```
**② GREEN** `app/src/ui/geometry.ts`（追記）
```ts
/** robot 中心表示のレイアウト: canvas から中心(cx,cy)と px/cm スケールを出す(純)。 */
export function sonarLayout(canvasW: number, canvasH: number, maxRangeCm: number, padPx: number): { cx: number; cy: number; scale: number } {
    const cx = canvasW / 2, cy = canvasH / 2;
    const radius = Math.min(cx, cy) - padPx * 2;
    return { cx, cy, scale: radius / maxRangeCm };
}
/** relDeg(0=正面=上・+左=反時計) と距離[cm] を canvas px 点に(純)。 */
export function sonarPointPx(relDeg: number, distanceCm: number, cx: number, cy: number, scale: number): { px: number; py: number } {
    const a = ((-90 - relDeg) * Math.PI) / 180;   // 0=上(正面), +relDeg(左)=反時計
    return { px: cx + Math.cos(a) * distanceCm * scale, py: cy + Math.sin(a) * distanceCm * scale };
}
/** サンプルの古さ(nowT-t)を不透明度 [min, min+span] に写す(純)。新しいほど濃い・fadeMs で線形に薄れる。 */
export function fadeAlpha(nowT: number, t: number, fadeMs: number, min: number, span: number): number {
    const age = Math.min(1, Math.max(0, (nowT - t) / fadeMs));   // 0(新)〜1(古)にクランプ
    return min + span * (1 - age);
}
```
→ vitest green（`sonarLayout`/`sonarPointPx`/`fadeAlpha`）・tsc クリーン（実測確認済み）。

---

## 4. UI（smoke）：`ui/sonar-view.ts` の `drawSonar`（レイヤ分割＝SRP）

> **SRP/DDD/TDD の是正**：当初案は `drawSonar` に幾何(角度→画面・スケール)**とフェード計算**を **inline** していた＝canvas 層に「テストできる計算」が混在し SRP 不足だった。改訂版は **①幾何/写像は §3.4 の純関数（`sonarLayout`/`sonarPointPx`/`fadeAlpha`・テスト済）に委譲 ②`drawSonar` は各レイヤ（ring/ray/robot/readout）を呼ぶ薄いオーケストレータ**にする（`draw.ts` と同じ作法）。**canvas 呼び出しだけが smoke、数値計算は全部テスト済み**。

```ts
// ui/sonar-view.ts — 実測のみの robot-centric 表示(描画だけ)。位置/軌跡は描かない。
// SRP: drawSonar は各レイヤを順に呼ぶだけ。幾何=ui/geometry(純・テスト済)、色寸法=ui/theme、文字列=ui/readout(純)。
import type { SonarSample, Sensors, Command } from "../types";
import { sonarLayout, sonarPointPx, fadeAlpha } from "./geometry";
import { formatSensorReadout } from "./readout";
import { COLORS as C, DIMS as D } from "./theme";

type Center = { cx: number; cy: number; scale: number };
type Cfg = { maxRangeCm: number; rangeRingCm: number; fadeMs: number };

/** 1フレーム描画。中心/スケールは純関数、各レイヤは単一責務。 */
export function drawSonar(
    ctx: CanvasRenderingContext2D, samples: SonarSample[], sensors: Sensors, cmd: Command,
    servoDeg: number, servoForwardDeg: number, cfg: Cfg,
): void {
    const { canvas } = ctx;
    const c = sonarLayout(canvas.width, canvas.height, cfg.maxRangeCm, D.textPad);   // 幾何=純関数
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawRangeRings(ctx, c, cfg);
    drawRays(ctx, samples, c, cfg);
    drawRobotCenter(ctx, c);
    drawSonarReadout(ctx, sensors, cmd, servoDeg, servoForwardDeg);
}

/** 距離リング(実スケール・何cm先か)。 */
function drawRangeRings(ctx: CanvasRenderingContext2D, c: Center, cfg: Cfg): void {
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let r = cfg.rangeRingCm; r <= cfg.maxRangeCm; r += cfg.rangeRingCm) {
        ctx.beginPath(); ctx.arc(c.cx, c.cy, r * c.scale, 0, Math.PI * 2); ctx.stroke();
    }
}

/** 実測 ray + ヒット点(古いほど淡く)。座標は sonarPointPx(純)に委譲。 */
function drawRays(ctx: CanvasRenderingContext2D, samples: SonarSample[], c: Center, cfg: Cfg): void {
    const now = samples.length ? samples[samples.length - 1].t : 0;
    for (const s of samples) {
        const p = sonarPointPx(s.relDeg, s.distanceCm, c.cx, c.cy, c.scale);          // 幾何=純関数
        ctx.globalAlpha = fadeAlpha(now, s.t, cfg.fadeMs, D.trailAlphaMin, D.trailAlphaSpan);   // 写像=純関数(§3.4)
        ctx.strokeStyle = C.coneLine; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(c.cx, c.cy); ctx.lineTo(p.px, p.py); ctx.stroke();
        ctx.fillStyle = C.hit; ctx.beginPath(); ctx.arc(p.px, p.py, D.coneTipRadius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
}

/** ロボット(中心・正面=上のシェブロン)。位置/向きは描かない=常に中心・上。 */
function drawRobotCenter(ctx: CanvasRenderingContext2D, c: Center): void {
    ctx.fillStyle = C.cyan;
    ctx.beginPath();
    ctx.moveTo(c.cx, c.cy - D.robotMarkerPx);
    ctx.lineTo(c.cx - D.robotMarkerPx * 0.6, c.cy + D.robotMarkerPx * 0.6);
    ctx.lineTo(c.cx + D.robotMarkerPx * 0.6, c.cy + D.robotMarkerPx * 0.6);
    ctx.closePath(); ctx.fill();
}

/** 実測リードアウト(X/Y 無し・文字列は ui/readout・純)。 */
function drawSonarReadout(ctx: CanvasRenderingContext2D, sensors: Sensors, cmd: Command, servoDeg: number, servoForwardDeg: number): void {
    ctx.font = D.font; ctx.textBaseline = "top"; ctx.fillStyle = C.text;
    ctx.fillText(formatSensorReadout(sensors.distanceCm, servoDeg, servoForwardDeg, sensors.lifted, cmd.kind), D.textPad, D.textPad);
}
```
### 4.1 定数の出どころ（ハードコーディング排除・全文）

`drawSonar` が参照する定数は下表。**実測で確認した結果、追加が要るのは `DIMS.robotMarkerPx` の1つだけ**（他は `ui/theme.ts` に既存）。

**`ui/theme.ts`（追記はこの1行だけ）**
```ts
export const DIMS = {
    // …既存 (textPad, trailAlphaMin, trailAlphaSpan, coneTipRadius, font …) はそのまま…
    robotMarkerPx: 8,   // ★追加: robot 中心マーカーの高さ[px](翼は ±0.6×)。旧生値 8/5 を置換
};
```

| `drawSonar` の参照 | 出どころ | 状態 |
|---|---|---|
| `C.cyan` `C.grid` `C.coneLine` `C.hit` `C.text` | `COLORS` | ✅ 既存 |
| `D.textPad`(余白) `D.trailAlphaMin/Span`(α) `D.coneTipRadius`(点) `D.font` | `DIMS` | ✅ 既存 |
| `D.robotMarkerPx`(マーカー) | `DIMS` | ➕ **追加**（上の1行） |
| `cfg.maxRangeCm` `cfg.rangeRingCm` `cfg.fadeMs` | `sonarConfig` | ✅（`fadeMs` は §5 で追加済） |

→ 当初案の生値 **`8`(余白)/`5,8`(マーカー)/`1500`(フェード)/`0.3,0.7`(α) は全て撤去**。余白=`D.textPad`、マーカー=`D.robotMarkerPx`、フェード=`cfg.fadeMs`、α=`D.trailAlphaMin/Span`。

> 逆に **`draw.ts` を削除すると theme の多く（`gridCm`/`frame*`/`trailWidth`/`coneHalfDeg`/`coneGlow`/`robotNose*`/`robotWing*`/`robotGlow`/`coreDotRadius`/`gridLabelBottom`、色 `frame`/`trail`/`cone`/`textDim`/`core`）が孤立**する＝§8.1 の掃除対象（未使用 export は tsc を割らないので任意）。theme 冒頭コメントの「戦術マップ」も「センサビュー」に更新。

---

## 5. 配線（`main.ts`・smoke）：render を実測のみに

推定 world/trail を**作らない**。`sensors`＋`cmd`＋首方向だけ。**sim/実機で同一パス**（distanceCm は sim=模擬計測(レイキャスト) / 実機=超音波の実測。どちらも“その場のセンサ値”で**積分しない→ドリフトしない**点が同じ＝位置推定ではない）。

```ts
import { toSonarSample, pruneSonar } from "./sensing/sonar";
import { nextServoDeg } from "./ui/geometry";
import { drawSonar } from "./ui/sonar-view";
import { sonarConfig } from "./config";

const forward = defaultSimConfig.servoForwardDeg;   // 正面角(ハードコーディングしない)
let realServoDeg = forward;
let sonar: import("./types").SonarSample[] = [];

function render(state: State, sensors: Sensors, cmd: Command): void {
    recording.tick(state, sensors, cmd);                                           // ★ログ(R1)継続。戻りtrailは表示に使わない=捨てる
    realServoDeg = nextServoDeg(realServoDeg, cmd.aimDeg);                          // 首の指令方向(nextServoDeg・実装済)
    const now = Date.now();
    const s = toSonarSample(realServoDeg, forward, sensors.distanceCm, now, sonarConfig.maxCm);
    if (s) sonar.push(s);
    sonar = pruneSonar(sonar, now, sonarConfig.windowMs);                           // 古い実測を落とす(積分しない)
    drawSonar(ctx, sonar, sensors, cmd, realServoDeg, forward, sonarConfig);        // 実測のみ・robot中心
}
```
- `render` から **`truth?`/`World`/`trail`/`EstimatorPoseSource`/`SimPoseSource` が消える**（表示に不要）。sim/実機の分岐も消える。
- 呼び出し側（simRunner / connect の onTick）は `render(state, sensors, cmd)` に統一。

### config（ハードコーディング排除）
```ts
export const sonarConfig = {
    maxCm: 150,        // 超音波の測定上限(machine-ref §6.1: 150cm クランプ)
    windowMs: 1500,    // 実測を残す時間(scan の左/中/右が並ぶ長さ)
    rangeRingCm: 20,   // 距離リング間隔(実スケール)
    maxRangeCm: 150,   // 描画外周(=maxCm)
    fadeMs: 1500,      // ray を淡くする時間(=windowMs と揃える。drawSonar が使用)
};
```
> `ui/theme` に `robotMarkerPx`（中心マーカー寸法）を追加＝§4 の生値撤去のため。`drawSonar` に渡す `cfg` は `sonarConfig`（`maxRangeCm`/`rangeRingCm`/`fadeMs`）。
> **表示サイズは canvas（`index.html`/CSS）が決める。`sonarConfig.maxRangeCm` が「外周＝何cmまで映すか」**。部屋(`roomW/roomH`)は表示に使わない（robot 中心だから）。

### 5.2 sim の運動は「実測 config から導出」（直書き撤去）

sim の per-tick 運動（`maxDriveCmPerTick`/`maxTurnDegPerTick`）を **`sim/model.ts` に直書きしない**。実測（`cm/s`・`deg/s`）は `config.ts` の `defaultMotionModel` を**唯一の源**とし、sim はそこから**導出**する（＝以前の「sim の値が2つ違う」を構造的に消す・脱ハードコーディング）。

**① テスト（RED）** `app/src/sim/sim-motion.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { simMotionFromModel } from "./model";
import type { MotionModel } from "../types";

describe("simMotionFromModel（実測 cm/s・deg/s → sim per-tick(speed255基準)）", () => {
    it("forward: cm/s × tick秒 × 255/refDrive", () => {
        const m: MotionModel = { forwardCmPerSec: 22, reverseCmPerSec: 22, turnDegPerSec: 125, refDriveSpeed: 80, refTurnSpeed: 100 };
        const r = simMotionFromModel(m, 120);
        expect(r.maxDriveCmPerTick).toBeCloseTo(8.415);   // 22*0.12*255/80
        expect(r.maxTurnDegPerTick).toBeCloseTo(38.25);   // 125*0.12*255/100
    });
    it("tickMs / 基準PWM に比例", () => {
        const m: MotionModel = { forwardCmPerSec: 10, reverseCmPerSec: 10, turnDegPerSec: 100, refDriveSpeed: 255, refTurnSpeed: 255 };
        const r = simMotionFromModel(m, 1000);            // 1秒・基準255 → per-tick = 実測そのもの
        expect(r.maxDriveCmPerTick).toBeCloseTo(10);
        expect(r.maxTurnDegPerTick).toBeCloseTo(100);
    });
});
```
**② GREEN** `app/src/sim/model.ts`（追記）
```ts
import type { MotionModel } from "../types";

/** sim の per-tick 運動(speed255 基準)を「実測 config(MotionModel)」から導出する(純)。
 *  ＝maxDrive/maxTurn を sim に直書きせず、実測 cm/s・deg/s の単一情報源から計算する。 */
export function simMotionFromModel(m: MotionModel, tickMs: number): { maxDriveCmPerTick: number; maxTurnDegPerTick: number } {
    const sec = tickMs / 1000;
    return {
        maxDriveCmPerTick: m.forwardCmPerSec * sec * (255 / m.refDriveSpeed),
        maxTurnDegPerTick: m.turnDegPerSec * sec * (255 / m.refTurnSpeed),
    };
}
```
**③ 配線** `defaultSimConfig` は導出値を使う（直書き 8/38 を撤去）。**`../config` からの import が必須**（漏らすと `defaultMotionModel`/`defaultConfig` が未定義で**コンパイル不可**＝ハマりどころ No.1）。
```ts
// sim/model.ts 冒頭
import type { Sensors, Command, Pose, MotionModel } from "../types";
import { integratePose } from "../domain/kinematics";
import { defaultConfig, defaultMotionModel } from "../config";   // ★これが無いと defaultSimConfig がコンパイル不可

export const defaultSimConfig: SimConfig = {
    roomW: 200, roomH: 150,           // ← 既存フィールド・本stageでは変更しない(全体を載せているだけ)。表示に不要=§5.3
    servoForwardDeg: 90,
    ...simMotionFromModel(defaultMotionModel, defaultConfig.tickMs),   // 直書きせず実測から導出
};
```
**検証済み（実測）**：import 追加で **tsc クリーン**／**model.test 18/18 パス**（テストは `sc.maxDriveCmPerTick`/`sc.maxTurnDegPerTick` の**相対参照**＝リテラル断定なしなので導出値でも壊れない）。`simMotionFromModel` を**ファイル下部で定義・上部で使用**しても OK（`function` 宣言は巻き上げられる）。依存は `sim/model → config` の**一方向で循環なし**（config は sim/model を import しない）。

> **単一情報源の効き**：`config.ts` の `defaultMotionModel.turnDegPerSec` を1回直せば sim が追従。現状 **`turnDegPerSec: 125`** なので導出値は **maxDrive≈8.415／maxTurn≈38.25**（旧直書き 8/38 とほぼ一致＝**退行なし**）。もし 90 のままだと maxTurn≈27.5 で**旋回が退行**するので、値は実測に合わせること。

### 5.3 表示 window の実コード（部屋とは無関係）＋ 部屋の位置づけ

**この節が答える2問**：
1. **「なぜ部屋を設定している？」→ stage13 は部屋を設定していない**。`roomW/roomH` は **stage13 以前からある sim の既存フィールド**で、§5.2 の `defaultSimConfig` 例に**全体を載せた副作用で見えているだけ**（本stageが触るのは `...simMotionFromModel(...)` の spread のみ）。表示には **100% 不要**。
2. **「index/CSS の変更コードは？」→ 下に用意**（`index.html` の `<canvas>` と `src/style.css` の `#sim`）。

**結論（ご指摘どおり）**：**部屋 `roomW/roomH` は表示に一切不要**。表示サイズは **canvas と CSS だけ**で決まる。旧 `<canvas 600×450>`＝部屋 200×150 と同じ **4:3 で癒着**していた——sonar は radial なので **正方形**にし、部屋から切り離す。

**index.html（1箇所）**
```html
<!-- 旧: <canvas id="sim" width="600" height="450"></canvas>   ← 部屋の 4:3 に癒着 -->
<canvas id="sim" width="480" height="480"></canvas>            <!-- sonar=radial なので正方形。部屋と無関係 -->
```

**src/style.css（`#sim`）**
```css
/* 旧: #sim { width: 100%; height: auto; max-width: 600px; ... } */
#sim {
    width: 100%; aspect-ratio: 1 / 1; height: auto;   /* 正方形を維持 */
    max-width: 480px; display: block;
    background: #060a10; border: 1px solid var(--line);
}
```
- `drawSonar` は `sonarLayout(canvas.width, canvas.height, …)` で **buffer(480×480) にスケール**＝**部屋を一切参照しない**。表示を大きく/小さくしたい時は **`width`/`height` 属性（と CSS `max-width`）だけ**いじる。
- （任意・高精細化）CSS 表示サイズ×`devicePixelRatio` を buffer に合わせる resize 処理を足せば滲まない。今は既存同様に静的 buffer で十分。

**では部屋(`roomW/roomH`)は何のために残るのか**：**sim 内部のレイキャスト専用**（`frontDistance` が距離を作り、cleaning が壁に反応する＝**結合テスト `cleaning.integration.test` が成立する**／sim モードの sonar に何か映る）。**表示には使わない・実機には存在しない**（実機の距離は超音波の実測）。サイズは「適当な箱」で**意味を持たない（校正ではない）**。

> **なぜ「消せない」か（＝“表示に不要”と“存在が不要”は別）**：sim の役目は「実機の cleaning 脳を模擬センサで回す」こと。脳は距離に反応して曲がる/scan するので、**指令に対し距離が空間的に整合して動く**必要がある（前進→近づく／旋回→別方向）。それを最小コストで与えるのが **矩形＋pose＋レイキャスト＝部屋**。「壁を検知させる」には「壁の位置＝サイズ」を必ず決めるしかなく、**原理的に省けない**（scripted/乱数の距離は矩形より恣意的で不忠実）。よって部屋は **表示には不要／sim には最小で原理的な環境**。廃止＝sim の距離生成ごと捨てる別判断（§8.1 Scope B）。**stage13 は部屋に一切触らない**。

---

## 6. システムフロー
```
onTick(state, sensors, cmd)   // sensors.distanceCm=実測, cmd.aimDeg=首の指令
   └─ render():
        realServoDeg = nextServoDeg(realServoDeg, cmd.aimDeg)          // 首方向(指令)
        sample = toSonarSample(realServoDeg, forward, sensors.distanceCm, now, maxCm)  // 実測→robot相対(無効はnull)
        sonar = pruneSonar(sonar ∪ sample, now, windowMs)              // 直近だけ(積分しない)
        drawSonar(...)                                                 // robot中心・ray/ring/readout(実測のみ)
   ＝sim も実機も同一。距離は両方“実測”。位置/向き/軌跡は一切描かない。
```

## 7. 依存関係（DDD・内向き）
```
main(配線・smoke)
   ├─▶ sensing/sonar(純・テスト済)         ─▶ types(SonarSample)
   ├─▶ ui/geometry.nextServoDeg(純・実装済)
   ├─▶ ui/sonar-view.drawSonar(canvas・smoke) ─▶ ui/readout.formatSensorReadout(純・テスト済)・ui/theme(定数)
   └─ sonarConfig(定数)
```
純粋・無依存の核：`sonar`/`formatSensorReadout`/`nextServoDeg`（テスト済）。副作用は `drawSonar`/`main` の端だけ。

## 8. 何が消えるか（副産物＝簡素化）
- **`ui/draw.ts`（推定タクティカルマップ）＋`formatReadout`(+その test) を削除**。**両方は不要**：`draw.ts`＝**world 中心・推定**（trail/pose/X-Y）、`sonar-view`＝**robot 中心・実測**、の別パラダイムで、実測のみに倒した以上 `draw.ts` は dead code。順序＝**`main` の `draw`→`drawSonar` 切替 → `draw.ts`/`formatReadout` を削除**（`formatReadout` を使うのは `draw.ts` だけ・確認済み）。※現状 `sonar-view.ts` は**空スタブ**で未使用 import により tsc が赤＝本 §4 を実装して解消する。
- **表示から `pose-source`(Sim/Estimator) が外れる** → 表示のために `SimConfig`/`motionModel` を校正しなくてよい（以前の「値が2つ」問題が表示から消滅）。
- **sim/実機の pose 分岐が消える**（`truth?` 不要）。
- **trail のドリフトが消える**（そもそも位置を描かない）。
- 「嘘を描かない」（[stage11](stage11-sim-tactical-map.md)）が**構造的に**達成される（推定を描く余地が無い）。

### 8.1 削除・移行の具体手順（build を緑に保ちながら）

**依存調査（実測済み）**：`formatReadout` を使うのは `draw.ts` だけ／`draw` を import するのは `main.ts` だけ／`draw.ts` を消すと `scaleFor`・`toPx`・`aimAngleDeg`・`polarPointCm` が、`formatReadout` を消すと `normalizeYaw` が孤立（他に使い手なし）。`draw.test.ts` は存在しない。

**要注意の密結合**：現 `main.render(state,sensors,cmd,truth?)` は `recording.tick()` の戻り `trail`（＝推定 pose 列）で `draw` を呼ぶ＝**描画が記録に依存**。ここを断ち、描画は `sensors`/`cmd`（実測）だけで回す。

- **Step 0（先に §3.4/§4 を実装）**：空スタブ `sonar-view.ts` を §4 で埋める＋`geometry` に `sonarLayout`/`sonarPointPx`＋`theme` に `robotMarkerPx`＋`sonarConfig` に `fadeMs`。→ **スタブ由来の tsc 赤が解消**。
- **Step 1（`main` の render を実測のみへ・`draw` を外す）**
  - import 差し替え：`- import { draw } from "./ui/draw";` → `+ import { drawSonar } from "./ui/sonar-view";` ＋ `+ import { toSonarSample, pruneSonar } from "./sensing/sonar";` ＋ `+ import { sonarConfig } from "./config";` ＋ `+ import type { SonarSample } from "./types";`。`readSensors` は初期描画専用なので import も外す。
  - `render` の本体を **§5 の実測版に置換**し、**`truth?` 引数を削除**（`let sonar: SonarSample[] = []` を module scope に）。
  - 初期描画（`draw(ctx, w0, …readSensors…)` の 5 行）→ `drawSonar(ctx, [], …)`（枠だけ）または `ctx.clearRect(...)`。
  - simRunner のコールバック：`render(state, sensors, cmd, simRobot.getWorld())` → **`render(state, sensors, cmd)`**（`truth`/`simRobot.getWorld()` を渡さない）。connect 側は既に `render(state, sensors, cmd)`。
  - ここで `draw.ts` はまだ存在（誰も import しない）＝ **tsc/tests 緑**。
- **Step 2（`draw.ts` 削除）**：`rm app/src/ui/draw.ts`。孤立した `scaleFor`/`toPx`/`aimAngleDeg`/`polarPointCm` を `geometry.ts`（＋`geometry.test.ts` の該当 describe）から削除。※未使用 export は tsc を割らないので**掃除目的**（残しても可）。→ 緑。
- **Step 3（`formatReadout` 削除）**：`readout.ts` から `formatReadout` を削除、`readout.test.ts` の `formatReadout` describe も削除（`formatSensorReadout` のテストは残す）。孤立した `normalizeYaw` も掃除（任意）。→ 緑。
- **Step 4（検証）**：`npm run test:run`／`npm run typecheck` 緑。sim/実機 smoke で **sonar が出る・位置/軌跡が出ない**を確認。

> **記録(ログ R1)は残す前提（Scope A・推奨）**：`recording`/`SimPoseSource`/`EstimatorPoseSource`/`motionModel` と保存ボタン(NDJSON/CSV)は**ログ用に残す**（表示に使わない・`estimated:true` で正直）。`formatReadout`/`draw.ts` の削除はログと無関係に成立。
> **さらに振り切る（Scope B・任意）**：ログも捨てるなら `recording-session`/`pose-source`(Sim/Estimator)/`recorder`/`download`/`motionModel`＋保存ボタンも削除＝**推定器が完全に消える**。ただし R1(軌跡ログ)を失うので、まずは Scope A 推奨。

## 9. テストは足りるか／DoD
| 観点 | 確認 |
|---|---|
| 実測→サンプル | `toSonarSample`（relDeg・**0/範囲外は null＝捏造しない**）ユニット。 |
| 積分しない | `pruneSonar`（直近だけ・境界）ユニット。 |
| 実測リードアウト | `formatSensorReadout`（**X/Y を出さない**・0は`--`・符号・離地）ユニット。 |
| 描画（canvas） | smoke：中心のロボット・ray が距離ぶん伸びる・**scan 中に左/中/右が並ぶ**・リングの実スケール。 |
| 実データ忠実 | 壁に寄ると ray が縮む／エコー無しは ray が消える（嘘を出さない）。 |

- [ ] `npm run test:run`（本stage純追加＝sonar 5・readout 3・geometry `sonarLayout`/`sonarPointPx`/`fadeAlpha`・sim-motion 2、既存 model.test 18 無傷）／`typecheck` 緑。
- [ ] sim/実機 smoke：**scan 中に左/中/右の実測 ray が並ぶ**・走行で前方 ray が伸縮・**位置/軌跡が一切出ない**（実測のみ）。

## 10. 据え置き／将来
- **軌跡ログ（R1）** は残すなら**別artifact**（推定 pose を `estimated:true` で記録・[stage7](stage7d-recorder-and-ui.md)）。表示とは分離。**完全に実測のみで統一したいなら、ログも「距離/指令の時系列（実測）」に切替**＝推定器ごと撤去でき、校正が一切不要になる（別stage）。
- **将来「指令→実測」に格上げ**：servo フィードバック / IMU yaw を firmware から返せば、首角も yaw も“実測”に変えられる（[machine-reference §9](../reference/machine-reference.md) の N 追加）。そのとき本ビューに実 yaw リング等を足せる。

---
関連：[stage11](stage11-sim-tactical-map.md)（純ヘルパ流用・嘘を描かない）／ `nextServoDeg`（実装済・再利用）／ [stage6](stage6-scan-and-reverse.md)（scan の左/中/右）／ [machine-reference.md](../reference/machine-reference.md) §6.1（超音波の実測仕様）
</content>
