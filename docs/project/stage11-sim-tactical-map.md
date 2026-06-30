# 段階11：SIM FEED 戦術マップ描画 — `ui.ts` を `ui/` フォルダへ分解（実データ忠実・純ヘルパTDD＋smoke）

> **ゴール**：sim の「緑の点が動くだけ」の描画を、**実データに忠実な HUD 戦術マップ**へ（スケール格子・機体マーカー・フェードする経路・実測スキャンコーン・数値リードアウト）。配色は [stage10](stage10-ui-layout-and-safety.md) の HUD と統一。
> **最重要原則（嘘を描かない）**：**すべての図形は実データに対応**。特にスキャンコーンの**向きと長さは `model.ts` の `readSensors` と同一式**（＝実際に測っている方向・距離をそのまま描く）。データを持たない**純装飾（回るレーダースイープ等）は入れない**。
> **設計の肝（SRP＋ハードコーディング排除）**：`draw()` を**1つの god 関数にしない**。①見た目の定数（色＋寸法）は `ui/theme.ts` に集約、②角度・座標・投影・正規化の純幾何は `ui/geometry.ts`、③リードアウト整形は `ui/readout.ts`（いずれも純・Vitest）。`ui/draw.ts` は**レイヤ関数を順に呼ぶ薄いオーケストレータ**にして canvas 副作用だけ smoke。
> **前提**：[7d](stage7d-recorder-and-ui.md)（trail）・**[stage9](stage9-main-single-responsibility.md)（記録は `recording`＝`createRecordingSession` が所有。`render` は `recording.tick(...)` で軌跡を得る）**・[stage10](stage10-ui-layout-and-safety.md)（HUD配色）・`sim/model.ts`（`readSensors`/`World.servoDeg`/`SimConfig.servoForwardDeg`）。**型/ロジック（model/cleaning/recorder/recording-session）は無改造**。
> **テストの性質**：角度・座標・整形の純ヘルパは Vitest（RED→GREEN）で固定（sign/y反転バグ＝“嘘”の最大要因を潰す）。canvas 描画は**目視 smoke**。本書のコードは **`vitest` 12 pass＋`tsc --strict` クリーンを実測確認済み**。

---

## 0. この回の増分

| # | 増分 | ファイル | テスト |
|---|---|---|---|
| 1 | 見た目の定数（色＋寸法）を集約 | `app/src/ui/theme.ts` | 定数＝tsc 型のみ（テスト不要） |
| 2 | 描画用の純幾何（aim/polar/**投影/正規化**） | `app/src/ui/geometry.ts` | **先に**（vitest・readSensors と同規約を固定） |
| 3 | リードアウト整形 `formatReadout` | `app/src/ui/readout.ts` | **先に**（vitest） |
| 4 | `draw()` を**レイヤ分割**（grid/frame/trail/cone/robot/readout） | `app/src/ui/draw.ts` | 副作用＝smoke |
| 5 | `render` に `distanceCm` を配線（**stage9 の `recording.tick` の上に**） | `app/src/main.ts` | smoke |

> 純ロジック（角度/座標/整形）だけ切り出してテストし、canvas は smoke——`code-design §7`（副作用は smoke）の作法どおり。**寸法 magic 値は theme に集約**＝ロジックに直書きしない。

> **置き場＝`app/src/ui/` フォルダ**：UI 系が増えた（draw/geometry/readout/theme＋テスト）ので、`domain/`・`sim/`・`telemetry/` と同じく**関心ごとにフォルダ化**し、`ui-` 接頭辞は落とす（フォルダが名前空間）。`main.ts` の import は `from "./ui"` → **`from "./ui/draw"`**。`ui/draw.ts` 内は `from "./geometry"`/`./readout"`/`./theme"`（兄弟）。`style.css` はページ全体の chrome なので **`src/` 直下に残す**（`index.html` の `/src/style.css` 据え置き）。barrel(`index.ts`)は作らない（このコードベースは直 import 流儀）。

---

## 1. 実データ ↔ 図形の対応（真 / 装飾の仕分け）

| 図形 | 実データ | 役割 |
|---|---|---|
| 機体の**中心ドット** | `pose.x / y` | **真・正確**（位置はこの点が断定） |
| 機体の**向きシェブロン** | `pose.yawDeg` | 真 |
| **トレイル** | 過去の pose 列 | 真（フェードは情報を歪めない） |
| **スキャンコーンの中心線・長さ** | `aimAngleDeg(yaw, servo, forward)` ＋ `distanceCm`（=`readSensors` と同式） | **真** |
| **壁ヒット点（ゴールド）** | `distanceCm` の終端 | 真・注目点（「壁はここ」を断定） |
| **スケール格子（50cm）** | 実寸スケール | 真（距離の基準） |
| **数値リードアウト** | `pose` / `servo` / `distance` | 真・定量 |
| コーンの**横幅（±7°）** | センサ公称FOVの**図示**（実測は中心線） | 装飾（控えめ・明記） |
| グロー（`shadowBlur`） | なし | 装飾（小さく・**位置をぼかさない**） |
| レーダースイープ／回る照準輪 | なし | ❌ **不採用** |

---

## 2. 純ヘルパ群（描画から「判断」を剥がす）

### 2.1 増分1：`ui/theme.ts`（見た目の定数＝単一の置き場）

色（`C`）に加え**寸法（`D`）も集約**する。`draw` のロジックに `7`/`150`/`0.75` 等を直書きしない＝ハードコーディング排除。定数オブジェクトなので**テスト不要**（tsc が型を保証）。

```ts
// ui/theme.ts — 戦術マップの見た目の定数(色＋寸法)を1箇所に集約。draw のロジックに magic 値を埋めない。
// 値はここだけ触れば調整できる(ハードコーディング排除)。canvas/DOM は知らない＝純データ。
export const COLORS = {
    cyan: "#35e0ff",
    grid: "rgba(53,224,255,0.10)",
    frame: "rgba(53,224,255,0.5)",
    trail: "rgba(53,224,255,0.55)",
    cone: "rgba(53,224,255,0.10)",
    coneLine: "rgba(53,224,255,0.35)",
    hit: "#ffb454",                 // 壁ヒット点＝ゴールド(注目点)
    text: "#9fe9ff",
    textDim: "rgba(159,233,255,0.5)",
    core: "#eafaff",
};
export const DIMS = {
    gridCm: 50,                     // スケール格子の間隔[cm](距離の基準)
    frameInset: 0.75,               // 枠の内側オフセット[px]
    frameWidth: 1.5,
    frameGlow: 8,
    trailWidth: 2,
    trailAlphaMin: 0.15,            // 最古の濃さ
    trailAlphaSpan: 0.85,           // 最古→現在 の増分
    coneHalfDeg: 7,                 // コーン横幅＝公称FOVの図示(±度)
    coneTipRadius: 3,               // 壁ヒット点の半径[px]
    coneGlow: 8,
    robotNoseCm: 10,                // シェブロン先端[cm]
    robotWingDeg: 150,              // 翼角(yaw から±)[度]
    robotWingCm: 7,                 // 翼長[cm]
    robotGlow: 10,
    coreDotRadius: 2,               // 現在地ドット[px]
    font: "12px ui-monospace, Menlo, Consolas, monospace",
    textPad: 8,
    gridLabelBottom: 18,            // GRID ラベルの下余白[px]
};
```

### 2.2 増分2：`ui/geometry.ts`（純幾何・テスト先行）

stage6 から在る `aimAngleDeg`/`polarPointCm` に、**`ui/draw.ts` に埋もれていた投影（`scaleFor`/`toPx`）と角度正規化（`normalizeYaw`）を集約**する＝これらは「描画用の幾何」で本来テスト可能なのに side-effect の殻に閉じていた。

**① テスト（RED）** `app/src/ui/geometry.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { aimAngleDeg, polarPointCm, scaleFor, toPx, normalizeYaw } from "./geometry";
import { defaultSimConfig } from "../sim/model";

describe("aimAngleDeg（センサ実測方向＝readSensors と同規約）", () => {
    it("首が正面(servo=forward)なら yaw のまま", () => {
        expect(aimAngleDeg(0, 90, 90)).toBe(0);
        expect(aimAngleDeg(30, 90, 90)).toBe(30);
    });
    it("servo 150(+60)=左へ+60 / 30(-60)=右へ-60 オフセット", () => {
        expect(aimAngleDeg(0, 150, 90)).toBe(60);
        expect(aimAngleDeg(0, 30, 90)).toBe(-60);
    });
});

describe("polarPointCm（極座標→world cm。0度=+x, 90度=+y, 反時計+）", () => {
    it("0度へ d → +x", () => { expect(polarPointCm(0, 0, 0, 50)).toEqual({ x: 50, y: 0 }); });
    it("90度へ → +y", () => { const p = polarPointCm(0, 0, 90, 50); expect(p.x).toBeCloseTo(0); expect(p.y).toBeCloseTo(50); });
    it("60度・50cm → (25, 43.3)", () => { const p = polarPointCm(0, 0, 60, 50); expect(p.x).toBeCloseTo(25); expect(p.y).toBeCloseTo(43.30, 1); });
    it("起点オフセットを足す", () => { expect(polarPointCm(10, 5, 0, 20)).toEqual({ x: 30, y: 5 }); });
});

describe("scaleFor / toPx（cm↔px 投影）", () => {
    it("scaleFor: 部屋を canvas に収める最小倍率", () => {
        expect(scaleFor(600, 450, defaultSimConfig)).toBe(3);   // min(600/200,450/150)
        expect(scaleFor(400, 450, defaultSimConfig)).toBe(2);   // 幅側が制約
    });
    it("toPx: cm→px・y 反転(奥=上)", () => {
        expect(toPx(10, 75, defaultSimConfig, 3)).toEqual({ px: 30, py: 225 });   // (150-75)*3
        expect(toPx(0, 150, defaultSimConfig, 3)).toEqual({ px: 0, py: 0 });      // 奥端=上端
    });
});

describe("normalizeYaw（0..359 表示用）", () => {
    it("負・360超を畳む", () => {
        expect(normalizeYaw(0)).toBe(0);
        expect(normalizeYaw(-90)).toBe(270);
        expect(normalizeYaw(450)).toBe(90);
        expect(normalizeYaw(359.6)).toBe(0);   // round(359.6)=360 → 0
    });
});
```
→ **赤**。

**② GREEN** `app/src/ui/geometry.ts`
```ts
// ui/geometry.ts — 描画用の幾何(純)。角度・極座標・cm↔px 投影・角度正規化。canvas/DOM は知らない＝単体テスト可。
// センサ方向は model.ts の readSensors と同一規約: 実方向 = pose.yawDeg + (servoDeg - servoForwardDeg)。
// この一致が「コーンが嘘をつかない」根拠。式を変えるときは readSensors と必ず揃える。
import type { SimConfig } from "../sim/model";

/** センサ(首)の実測方向[度]。world系・0=+x・反時計回りが+。 */
export function aimAngleDeg(yawDeg: number, servoDeg: number, servoForwardDeg: number): number {
    return yawDeg + (servoDeg - servoForwardDeg);
}

/** 点(x,y)[cm]から angleDeg 方向へ distCm 進んだ点[cm]（world系）。 */
export function polarPointCm(x: number, y: number, angleDeg: number, distCm: number): { x: number; y: number } {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: x + Math.cos(rad) * distCm, y: y + Math.sin(rad) * distCm };
}

/** 部屋(cm)を Canvas(px) に収める拡大率。 */
export function scaleFor(canvasW: number, canvasH: number, sc: SimConfig): number {
    return Math.min(canvasW / sc.roomW, canvasH / sc.roomH);
}

/** cm座標 → Canvas px座標。y は反転(奥=上 を 画面の上方向 へ)。 */
export function toPx(x: number, y: number, sc: SimConfig, scale: number): { px: number; py: number } {
    return { px: x * scale, py: (sc.roomH - y) * scale };
}

/** 角度を 0..359 に正規化(表示用)。 */
export function normalizeYaw(deg: number): number {
    return ((Math.round(deg) % 360) + 360) % 360;
}
```
→ 緑。

### 2.3 増分3：`ui/readout.ts`（リードアウト整形・純）

数値リードアウトの**文字列組み立て（yaw 正規化・aim 符号・dist 整形）は表示ロジック**＝canvas と無関係。剥がしてテストする。

**① テスト（RED）** `app/src/ui/readout.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { formatReadout } from "./readout";
import type { Pose } from "../types";

const pose = (x: number, y: number, yawDeg: number): Pose => ({ x, y, yawDeg });

describe("formatReadout", () => {
    it("X/Y/YAW/AIM/DIST を整形(servo=forward→AIM +0)", () => {
        expect(formatReadout(pose(20, 75, 0), 90, 90, 48)).toBe("X 20.0  Y 75.0  YAW 0°  AIM +0°  DIST 48cm");
    });
    it("distance 省略 → DIST --", () => {
        expect(formatReadout(pose(0, 0, 0), 90, 90)).toBe("X 0.0  Y 0.0  YAW 0°  AIM +0°  DIST --");
    });
    it("yaw を 0..359 正規化・aim 符号", () => {
        expect(formatReadout(pose(0, 0, -90), 150, 90, 10)).toBe("X 0.0  Y 0.0  YAW 270°  AIM +60°  DIST 10cm");
        expect(formatReadout(pose(0, 0, 0), 30, 90)).toContain("AIM -60°");
    });
});
```
→ **赤**。

**② GREEN** `app/src/ui/readout.ts`
```ts
// ui/readout.ts — 数値リードアウトの文字列を作る(純)。canvas は知らない＝単体テスト可。
import type { Pose } from "../types";
import { normalizeYaw } from "./geometry";

/** HUD の1行(X/Y/YAW/AIM/DIST)。distanceCm 省略時は DIST --。yaw は 0..359 表示。 */
export function formatReadout(pose: Pose, servoDeg: number, servoForwardDeg: number, distanceCm?: number): string {
    const yawN = normalizeYaw(pose.yawDeg);
    const aimOff = Math.round(servoDeg - servoForwardDeg);
    const aimSign = aimOff >= 0 ? "+" : "";
    const dist = distanceCm != null ? `${Math.round(distanceCm)}cm` : "--";
    return `X ${pose.x.toFixed(1)}  Y ${pose.y.toFixed(1)}  YAW ${yawN}°  AIM ${aimSign}${aimOff}°  DIST ${dist}`;
}
```
→ 緑（vitest：2.2＋2.3 で **12 tests pass** 実測）。

---

## 3. 増分4：`ui/draw.ts` の `draw()` をレイヤ分割（smoke）

`draw()` は「投影を作る → clear → 各レイヤを順に呼ぶ」だけの薄いオーケストレータ。1レイヤ＝1関数（SRP）で、寸法は `D`、色は `C`、幾何は ui/geometry、リードアウト文字列は ui/readout に委譲。公開シグネチャ `draw(ctx, world, sc, trail?, distanceCm?)` は**据え置き**（後方互換：`distanceCm` 省略でコーン非表示でも throw しない）。

```ts
// ui/draw.ts — Canvas に sim の戦術マップを描く(描画だけ・状態は持たない)。図形は全て実データに対応。
// SRP: draw は各レイヤを順に呼ぶオーケストレータ。寸法/色=ui/theme、幾何/整形=ui/geometry・ui/readout(純・テスト済)。
import type { World, SimConfig } from "../sim/model";
import type { Pose } from "../types";
import { aimAngleDeg, polarPointCm, scaleFor, toPx } from "./geometry";
import { formatReadout } from "./readout";
import { COLORS as C, DIMS as D } from "./theme";

/** cm→px 投影(クロージャ。pure な toPx から作る)。 */
type Projector = (x: number, y: number) => { px: number; py: number };

/** 1フレーム描画。trail=過去pose列, distanceCm=前方センサ実測[cm](省略/0=コーン非表示)。全図形が実データに対応。 */
export function draw(ctx: CanvasRenderingContext2D, world: World, sc: SimConfig, trail?: Pose[], distanceCm?: number): void {
    const { canvas } = ctx;
    const scale = scaleFor(canvas.width, canvas.height, sc);
    const P: Projector = (x, y) => toPx(x, y, sc, scale);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawGrid(ctx, P, sc);
    drawFrame(ctx, sc, scale);
    if (trail) drawTrail(ctx, P, trail);
    if (distanceCm && distanceCm > 0) drawSensorCone(ctx, P, world, sc, distanceCm);
    drawRobot(ctx, P, world.pose);
    drawReadout(ctx, world, sc, distanceCm);
}

/** スケール格子(GRID ごと＝距離の基準)。 */
function drawGrid(ctx: CanvasRenderingContext2D, P: Projector, sc: SimConfig): void {
    ctx.lineWidth = 1; ctx.strokeStyle = C.grid; ctx.beginPath();
    for (let x = 0; x <= sc.roomW; x += D.gridCm) { const a = P(x, 0), b = P(x, sc.roomH); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); }
    for (let y = 0; y <= sc.roomH; y += D.gridCm) { const a = P(0, y), b = P(sc.roomW, y); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); }
    ctx.stroke();
}

/** 部屋の枠(発光・小さめ)。 */
function drawFrame(ctx: CanvasRenderingContext2D, sc: SimConfig, scale: number): void {
    ctx.strokeStyle = C.frame; ctx.lineWidth = D.frameWidth;
    ctx.shadowColor = C.cyan; ctx.shadowBlur = D.frameGlow;
    ctx.strokeRect(D.frameInset, D.frameInset, sc.roomW * scale - D.frameInset * 2, sc.roomH * scale - D.frameInset * 2);
    ctx.shadowBlur = 0;
}

/** トレイル(実際の経路・古いほど淡く＝情報は歪めない)。 */
function drawTrail(ctx: CanvasRenderingContext2D, P: Projector, trail: Pose[]): void {
    if (trail.length < 2) return;
    ctx.strokeStyle = C.trail; ctx.lineWidth = D.trailWidth;
    for (let i = 1; i < trail.length; i++) {
        const a = P(trail[i - 1].x, trail[i - 1].y), b = P(trail[i].x, trail[i].y);
        ctx.globalAlpha = D.trailAlphaMin + D.trailAlphaSpan * (i / (trail.length - 1));   // 現在に近いほど濃い
        ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

/** スキャンコーン＝センサ実測(中心線=測った方向, 終端=測った距離)。 */
function drawSensorCone(ctx: CanvasRenderingContext2D, P: Projector, world: World, sc: SimConfig, distanceCm: number): void {
    const { x, y, yawDeg } = world.pose;
    const here = P(x, y);
    const aim = aimAngleDeg(yawDeg, world.servoDeg, sc.servoForwardDeg);
    const tip = polarPointCm(x, y, aim, distanceCm);                  // 実測の壁ヒット点
    const eL = polarPointCm(x, y, aim + D.coneHalfDeg, distanceCm);
    const eR = polarPointCm(x, y, aim - D.coneHalfDeg, distanceCm);
    const pTip = P(tip.x, tip.y), pL = P(eL.x, eL.y), pR = P(eR.x, eR.y);
    ctx.fillStyle = C.cone;
    ctx.beginPath(); ctx.moveTo(here.px, here.py); ctx.lineTo(pL.px, pL.py); ctx.lineTo(pR.px, pR.py); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.coneLine; ctx.lineWidth = 1;                 // 中心ビーム＝実測方向・実測長
    ctx.beginPath(); ctx.moveTo(here.px, here.py); ctx.lineTo(pTip.px, pTip.py); ctx.stroke();
    ctx.fillStyle = C.hit; ctx.shadowColor = C.hit; ctx.shadowBlur = D.coneGlow;   // 壁ヒット点(ゴールド)
    ctx.beginPath(); ctx.arc(pTip.px, pTip.py, D.coneTipRadius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
}

/** 機体マーカー(向き＝シェブロン / 位置＝中心ドットで断定)。寸法は cm でマップにスケール。 */
function drawRobot(ctx: CanvasRenderingContext2D, P: Projector, pose: Pose): void {
    const { x, y, yawDeg } = pose;
    const here = P(x, y);
    const nose = polarPointCm(x, y, yawDeg, D.robotNoseCm);
    const wl = polarPointCm(x, y, yawDeg + D.robotWingDeg, D.robotWingCm);
    const wr = polarPointCm(x, y, yawDeg - D.robotWingDeg, D.robotWingCm);
    const pN = P(nose.x, nose.y), pWL = P(wl.x, wl.y), pWR = P(wr.x, wr.y);
    ctx.fillStyle = C.cyan; ctx.shadowColor = C.cyan; ctx.shadowBlur = D.robotGlow;
    ctx.beginPath(); ctx.moveTo(pN.px, pN.py); ctx.lineTo(pWL.px, pWL.py); ctx.lineTo(pWR.px, pWR.py); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = C.core;                                          // 正確な現在地＝中心の白点
    ctx.beginPath(); ctx.arc(here.px, here.py, D.coreDotRadius, 0, Math.PI * 2); ctx.fill();
}

/** 数値リードアウト(文字列は ui/readout・純)。 */
function drawReadout(ctx: CanvasRenderingContext2D, world: World, sc: SimConfig, distanceCm?: number): void {
    ctx.font = D.font; ctx.textBaseline = "top";
    ctx.fillStyle = C.text;
    ctx.fillText(formatReadout(world.pose, world.servoDeg, sc.servoForwardDeg, distanceCm), D.textPad, D.textPad);
    ctx.fillStyle = C.textDim;
    ctx.fillText(`GRID ${D.gridCm}cm`, D.textPad, ctx.canvas.height - D.gridLabelBottom);
}
```

> **なぜ嘘がないか**：コーンの方向 `aimAngleDeg(...)` と終端 `polarPointCm(..., distanceCm)` は、`readSensors`→`frontDistance` の式（`pose.yawDeg + (servoDeg - servoForwardDeg)` 方向のレイ）と**同一**。だから「ゴールドのヒット点＝実際にセンサが見ている壁」。壁に近づけばコーンが縮む＝測距の挙動がそのまま見える。

---

## 4. 増分5：`main.ts` の `render` に `distanceCm` を配線（smoke）

> `render` は `recording.tick(...)` で軌跡を得ているので、stage11 はそこへ `sensors.distanceCm` を1つ足すだけ。

```ts
// ✗ 古い(pre-stage9): main が recorder/recTraj を持っていた頃。今は存在しない。
//   if (recorder && recTraj) { recorder.onTick(...); const poses = recTraj.samples()...; }

// ✓ 現行: stage9 の render に distanceCm を足すだけ。readSensors は初期描画の距離用に import。
import { defaultSimConfig, readSensors } from "./sim/model";   // ★readSensors を追加 import

function render(state: State, sensors: Sensors, cmd: Command, truth?: World): void {
    const trail = recording.tick(state, sensors, cmd);          // 記録は recording が所有(stage9)
    if (trail) {
        const world = truth ?? { pose: trail[trail.length - 1], servoDeg: defaultConfig.scanCenterDeg };
        draw(ctx, world, defaultSimConfig, trail, sensors.distanceCm);          // ★距離を渡す
    } else if (truth) {
        draw(ctx, truth, defaultSimConfig, undefined, sensors.distanceCm);      // ★距離を渡す
    }
}

// 初期状態を1回描く（まだ sensors が無いので readSensors で距離を補う）
const w0 = simRobot.getWorld();
draw(ctx, w0, defaultSimConfig, undefined, readSensors(w0, defaultSimConfig).distanceCm);  // ★
```

> **実機（推定）描画について（正直に）**：実機では `world` は推定 pose・`servoDeg` は固定（`scanCenterDeg`）。コーンは**推定姿勢から body 正面へ・長さ＝実測距離**になる（向きは推定依存）。sim では `world` が真値・`servoDeg` も実値なのでコーンは厳密。リードアウトの `DIST` は sim/実機とも実測値。

---

## 5. テストは足りるか（十分性チェック）

| 観点 | 確認 |
|---|---|
| **角度・座標・投影（嘘の最大要因）** | `aimAngleDeg`（首オフセット符号）・`polarPointCm`（0/90/60度・起点）・**`scaleFor`/`toPx`（倍率・y反転）**・`normalizeYaw` を unit 固定＝**sign/向き/反転バグを捕捉**。 |
| **リードアウト整形** | `formatReadout`（yaw 0..359・aim 符号・dist `--`/値・小数桁）を unit 固定。 |
| **コーンが実測と一致** | 方向・長さの式が `readSensors` と同一（コメント＋テストで規約固定）。目視：壁に寄るとコーンが縮む／ヒット点が壁に乗る。 |
| **寸法のハードコーディング排除** | 全 magic 値は `ui/theme.DIMS` に集約（`draw` のロジックに直書きが無い）＝tsc 型のみ（定数はテスト不要）。 |
| **SRP** | `draw` はオーケストレータ、各レイヤは単一責務関数（grid/frame/trail/cone/robot/readout）。 |
| **後方互換** | `distanceCm` 省略/0 でコーン非表示でも描ける（`draw(ctx, world, sc)` のままでも throw しない）。 |
| **描画（canvas副作用）** | smoke：位置/向き/格子/リードアウトが pose と一致、トレイルがフェード、純装飾が無い。 |
| **ユニット不能・別手段** | canvas 描画そのもの・`main` の配線＝目視 smoke（`code-design §7`）。 |

**結論**：「嘘を描かない」の要（角度・座標・投影・整形）は**純ヘルパで全てテスト済み**（12 tests）。寸法は theme に集約してロジックから締め出した。残りは canvas の見た目で smoke。

---

## 6. Definition of Done（smoke 中心）
- [ ] `npm run test:run` 緑（`ui/geometry.test.ts`＝9・`ui/readout.test.ts`＝3 含む）／`npm run typecheck` 緑。既存も緑（model/recorder/recording-session 無改造）。
- [ ] 機体が **pose の位置に正確**（中心ドット）で、**向き（シェブロン）が yaw と一致**。
- [ ] **スキャンコーンが servo/yaw の実方向**を向き、**長さ＝`distanceCm`**（終端のゴールド点が壁に乗る）。sim で壁に寄ると**コーンが縮む**。
- [ ] **スケール格子 50cm**・**リードアウトの数値が pose と一致**（X/Y/YAW/AIM/DIST）。
- [ ] **トレイルが従来どおり**出てフェードする（記録中＝`recording.tick` が軌跡を返す間）。
- [ ] **純装飾（レーダースイープ等）が無い**／グローで現在地がぼやけない。
- [ ] `distanceCm` 省略時もクラッシュせず描画（後方互換）。
- [ ] **見た目の調整は `ui/theme.ts` だけ**で完結する（寸法/色がロジックに散っていない）。

---
関連：[stage9](stage9-main-single-responsibility.md)（`recording.tick`＝render の軌跡供給元・§4 の前提）／ [stage10](stage10-ui-layout-and-safety.md)（HUD配色・暗canvas）／ [stage7d](stage7d-recorder-and-ui.md)（trail）／ [sim/model.ts](../../app/src/sim/model.ts)（`readSensors`＝コーンの真値の出どころ）／ [code-design.md](code-design.md)（§7 副作用は smoke・§3 `ui/draw.ts` は描画だけ）
</content>
