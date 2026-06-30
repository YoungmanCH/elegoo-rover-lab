# 段階7d：記録の結線・保存・描画 — TDD（仕上げ）

> **ゴール**：[7a〜7c](stage7c-trajectory-log.md) の純部品を「**onTick で記録するアプリ部品 `TrajectoryRecorder`**」に束ね、**真値/推定の差し替え（`PoseSource`）・保存（download）・地図トレイル（ui）・配線（main/config）**まで通す。ここで初めて副作用（DOM・時計）が登場するので、**注入でテスト可能**にする（`session.test.ts` の fake 流儀）。
> **前提**：[7a](stage7a-pose-and-kinematics.md)／[7b](stage7b-pose-estimation.md)／[7c](stage7c-trajectory-log.md) 完了。`runner.ts` / `domain/cleaning.ts` は**無改造**。
> **このstageの位置**：[7a](stage7a-pose-and-kinematics.md) → [7b](stage7b-pose-estimation.md) → [7c](stage7c-trajectory-log.md) → 7d(本書)。

---

## 0. この回の増分

| # | 増分 | ファイル | テスト |
|---|---|---|---|
| 1 | `PoseSource`（真値/推定の差し替え） | `telemetry/pose-source.ts` | **先に** |
| 2 | `TrajectoryRecorder`（onTick 購読・注入） | `telemetry/recorder.ts` | **先に**（fake clock/PoseSource） |
| 3 | `download`（ファイル名は純テスト・保存は副作用） | `telemetry/download.ts` | 純部分のみ |
| 4 | `config.ts` 追加（校正値・桁＝ハードコーディング集約） | `config.ts` | — |
| 5 | **結合テスト**（シムを回し空でない・往復可能な軌跡） | `telemetry/recorder.integration.test.ts` | **先に**（総仕上げ） |
| 6 | `ui` トレイル ＋ `main` 配線 | `ui.ts` / `main.ts` | 副作用＝smoke（DoD） |

---

## 1. 増分1：`PoseSource`（依存逆転で真値/推定を差し替え）

### ① テスト（RED）
`app/src/telemetry/pose-source.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { SimPoseSource, EstimatorPoseSource } from "./pose-source";   // ← RED
import type { MotionModel, Command } from "../types";

const mm: MotionModel = { forwardCmPerSec: 20, reverseCmPerSec: 20, turnDegPerSec: 90, refDriveSpeed: 80, refTurnSpeed: 100 };
const stop: Command = { kind: "stop", speed: 0 };
const fwd: Command = { kind: "forward", speed: 80 };

describe("SimPoseSource（真値）", () => {
    it("シムの現在 pose をそのまま返す", () => {
        const sim = { getWorld: () => ({ pose: { x: 1, y: 2, yawDeg: 3 } }) };
        expect(new SimPoseSource(sim).next(stop, 100)).toEqual({ x: 1, y: 2, yawDeg: 3 });
    });
});

describe("EstimatorPoseSource（推定・状態を持つ）", () => {
    it("呼ぶたびに estimateStep で前進していく", () => {
        const src = new EstimatorPoseSource({ x: 0, y: 0, yawDeg: 0 }, mm);
        expect(src.next(fwd, 1000).x).toBeCloseTo(20);
        expect(src.next(fwd, 1000).x).toBeCloseTo(40);   // 累積
    });
});
```

### ② GREEN
`app/src/telemetry/pose-source.ts`
```ts
// pose-source.ts — 「次の Pose をくれ」の抽象。真値(Sim)/推定(Estimator)を差し替える(依存逆転)。
// recorder はこの interface にしか依存しない＝sim/実機を分岐なしで同じ記録ロジックに通せる。
import type { Pose, Command, MotionModel } from "../types";
import { estimateStep } from "../localization/pose-estimator";

/**
 * 次tickの Pose を返す抽象。実装は真値(Sim)か推定(Estimator)。
 * @param cmd   この tick に出した指令。
 * @param dtMs  直前tickからの実経過[ms]（名目tickではなく実測。推定の積分に使う）。
 * @returns     本体姿勢 Pose（x,y は[cm]／yawDeg は[度], 0=+x方向・反時計回りが+）。
 */
export interface PoseSource { next(cmd: Command, dtMs: number): Pose; }

/** sim 用：シムが既に知っている真値 pose を覗くだけ（推定しない＝誤差ゼロ）。記録側は estimated=false。 */
export class SimPoseSource implements PoseSource {
    constructor(private sim: { getWorld(): { pose: Pose } }) {}
    // 真値なので cmd/dt は不要（シムが物理を進めた結果を読むだけ）。だが PoseSource と同じ引数で宣言する
    // (具象型経由でも next(cmd,dt) として呼べるように)。未使用引数は _ 前缀で noUnusedParameters を満たす。
    next(_cmd: Command, _dtMs: number): Pose { return this.sim.getWorld().pose; }
}

/**
 * 実機用：エンコーダが無いので推測航法(dead-reckoning)で pose を推定する。記録側は estimated=true。
 * pose を内部状態として持ち、next() のたびに estimateStep で1tick進める＝呼ぶほど誤差が累積(ドリフト)する。
 */
export class EstimatorPoseSource implements PoseSource {
    constructor(private pose: Pose, private m: MotionModel) {}   // pose=初期姿勢 / m=校正(PWM→物理量)
    // cmd と実経過 dtMs[ms] から1tick分を積分して内部 pose を更新し、それを返す。
    next(cmd: Command, dtMs: number): Pose {
        return (this.pose = estimateStep(this.pose, cmd, dtMs, this.m));
    }
}
```

---

## 2. 増分2：`TrajectoryRecorder`（onTick 購読・注入でテスト可能）

### ① テスト（RED）— fake clock ＋ fake PoseSource
`app/src/telemetry/recorder.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { TrajectoryRecorder } from "./recorder";          // ← RED
import { createTrajectory } from "./trajectory";
import type { PoseSource } from "./pose-source";
import type { Pose, Command, Sensors, State, TrajectoryHeader } from "../types";

class FakePoseSource implements PoseSource {
    calls: { cmd: Command; dtMs: number }[] = [];
    constructor(private poses: Pose[]) {}
    next(cmd: Command, dtMs: number): Pose { this.calls.push({ cmd, dtMs }); return this.poses[this.calls.length - 1]; }
}
const clock = (ts: number[]) => { let i = 0; return () => ts[i++]; };   // 時刻を台本で渡す

const header = { v: 1 } as unknown as TrajectoryHeader;
const sensors: Sensors = { distanceCm: 48, yawDeg: 0, lifted: false };
const state: State = { phase: "drive", turnTicksLeft: 0, leftCm: -1, turnDir: "left", reverseTicksLeft: 0 };
const fwd: Command = { kind: "forward", speed: 80 };

function setup(times: number[], poses: Pose[]) {
    const traj = createTrajectory(header);
    const ps = new FakePoseSource(poses);
    const rec = new TrajectoryRecorder({ now: clock(times), t0: times[0], poseSource: ps, traj, estimated: true, precision: 1 });
    return { traj, ps, rec };
}

describe("TrajectoryRecorder", () => {
    it("初回 onTick: t=0, dt=0, サンプル1件・estimated 伝播", () => {
        const { traj, rec } = setup([1000], [{ x: 1, y: 0, yawDeg: 0 }]);
        rec.onTick(state, sensors, fwd);
        expect(traj.size()).toBe(1);
        expect(traj.samples()[0]).toMatchObject({ t: 0, dt: 0, estimated: true, cmdKind: "forward" });
    });

    it("2回目: dt=時刻差・t 増加・PoseSource に (cmd, dt) を渡す", () => {
        const { traj, ps, rec } = setup([1000, 1120], [{ x: 1, y: 0, yawDeg: 0 }, { x: 2, y: 0, yawDeg: 0 }]);
        rec.onTick(state, sensors, fwd);
        rec.onTick(state, sensors, fwd);
        expect(ps.calls[1].dtMs).toBe(120);
        expect(traj.samples()[1].t).toBe(120);
        expect(traj.samples()[1].pose).toEqual({ x: 2, y: 0, yawDeg: 0 });
    });

    it("finish() で記録した Trajectory を返す", () => {
        const { traj, rec } = setup([1000], [{ x: 1, y: 0, yawDeg: 0 }]);
        rec.onTick(state, sensors, fwd);
        expect(rec.finish()).toBe(traj);
    });
});
```

### ② GREEN
`app/src/telemetry/recorder.ts`
```ts
// recorder.ts — onTick を購読し sample 化して Trajectory に積むアプリ部品。
// now(時計)と poseSource を注入=実機/DOM 無しで完全にテストできる。
import type { State, Sensors, Command, TickObservation } from "../types";
import type { PoseSource } from "./pose-source";
import type { Trajectory } from "./trajectory";
import { makeSample } from "./sample";

export class TrajectoryRecorder {
    private last: number;
    constructor(private d: {
        now: () => number; t0: number; poseSource: PoseSource;
        traj: Trajectory; estimated: boolean; precision: number;
    }) { this.last = d.t0; }

    onTick(state: State, sensors: Sensors, cmd: Command): void {
        const now = this.d.now();
        const dt = now - this.last; this.last = now;
        const pose = this.d.poseSource.next(cmd, dt);
        // 観測を TickObservation に明示して組む（型注釈で取り違え・漏れを recorder 側で検出）。
        const obs: TickObservation = {
            t: now - this.d.t0, dt, cmd, sensors, phase: state.phase, pose, estimated: this.d.estimated,
        };
        this.d.traj.append(makeSample(obs, this.d.precision));
    }
    finish(): Trajectory { return this.d.traj; }
}
```

---

## 3. 増分3：`download`（純部分だけテスト）

### ① テスト（RED）
`app/src/telemetry/download.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { recordingFilename } from "./download";          // ← RED

describe("recordingFilename", () => {
    it("sessionId と拡張子からファイル名を組む", () => {
        expect(recordingFilename("2026-06-28T12-00-00", "ndjson")).toBe("trajectory-2026-06-28T12-00-00.ndjson");
        expect(recordingFilename("s1", "csv")).toBe("trajectory-s1.csv");
    });
});
```

### ② GREEN
`app/src/telemetry/download.ts`
```ts
// download.ts — 保存。純部分(ファイル名)だけ切り出してテスト、Blob/<a> 副作用は smoke。
export function recordingFilename(sessionId: string, ext: "ndjson" | "csv"): string {
    return `trajectory-${sessionId}.${ext}`;
}

export function downloadText(filename: string, text: string, mime: string): void {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}
```

---

## 4. 増分4：`config.ts` 追加（ハードコーディング集約）

```ts
import type { MotionModel } from "./types";

/** 推定の校正値。実測して埋める(§7b 校正)。値はここ1か所だけ。 */
export const defaultMotionModel: MotionModel = {
    forwardCmPerSec: 22,                  // driveSpeed の実速度。要実測。目標20〜30cm/s
    reverseCmPerSec: 22,                // reverseSpeed の実速度。要実測(前進と同程度を仮置き)
    turnDegPerSec: 90,                  // turnSpeed の実角速度。要実測。目標60〜120°/s
    refDriveSpeed: defaultConfig.driveSpeed,
    refTurnSpeed: defaultConfig.turnSpeed,
};

/** 軌跡ログの調整。 */
export const telemetryConfig = {
    posePrecision: 1,                   // pose の小数桁
};
```

---

## 5. 増分5：結合テスト（総仕上げ＝十分性の証明）

純部品を結線し「**空でない・実際に動いた・往復可能な軌跡**」が**実機/DOM 無し**で出ることを確認する。配線そのものの正しさを担保する一番効く1本。

`app/src/telemetry/recorder.integration.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { SimRobot } from "../sim/sim-robot";
import { defaultSimConfig } from "../sim/model";
import { defaultConfig, initialState, defaultMotionModel } from "../config";
import { step } from "../domain/cleaning";
import { createTrajectory } from "./trajectory";
import { makeHeader } from "./session-meta";
import { SimPoseSource } from "./pose-source";
import { TrajectoryRecorder } from "./recorder";
import { toNDJSON } from "./serialize";

describe("結合: シムを回すと空でない・往復可能な軌跡が出る", () => {
    it("20tick 回す → 21行NDJSON・全行 valid JSON・pose が動いている", async () => {
        const sim = new SimRobot({ pose: { x: 20, y: 75, yawDeg: 0 }, servoDeg: 90 }, defaultSimConfig);
        const ps = new SimPoseSource(sim);
        let t = 0; const now = () => (t += 120);     // 120ms 刻みの擬似時計
        const traj = createTrajectory(makeHeader({
            sessionId: "it", startedAtIso: "x", source: "sim",
            config: defaultConfig, motionModel: defaultMotionModel, pose0: { x: 20, y: 75, yawDeg: 0 },
        }));
        const rec = new TrajectoryRecorder({ now, t0: 0, poseSource: ps, traj, estimated: false, precision: 1 });

        let st = initialState;
        for (let i = 0; i < 20; i++) {
            const sensors = await sim.read();
            const { cmd, next } = step(sensors, st, defaultConfig);
            await sim.send(cmd);                      // 世界を進める
            rec.onTick(next, sensors, cmd);           // ★send 後の真値 pose を記録
            st = next;
        }

        expect(traj.size()).toBe(20);
        const lines = toNDJSON(traj).trim().split("\n");
        expect(lines.length).toBe(21);                // header + 20
        expect(() => lines.forEach((l) => JSON.parse(l))).not.toThrow();   // 往復可能
        expect(traj.samples().some((s) => s.pose.x !== 20 || s.pose.y !== 75)).toBe(true);  // 実際に動いた
    });
});
```
> これが緑＝「**パイプライン全体（read→step→send→記録→整形）が動く**」の証明。`step`/`runner` の無改造とも整合。

---

## 6. 増分6：`ui` トレイル ＋ `main` 配線（副作用＝smoke）

純ロジックは 7a〜7c ＋ recorder/pose-source で尽きた。**ここは副作用（DOM・時計）なのでユニットせず smoke で確認**する（正直に）。やることは2つだけ：**(A) 描画にトレイルを足す／(B) 部品を `main` で配線する**。

### (A) `ui.ts`：軌跡トレイルを描く
`draw(...)` に**任意引数 `trail?: Pose[]`** を足し、本体に**ポリライン描画を1ブロック挿す**だけ。既存の `toPx`（cm→px・y反転）・色定数・`beginPath/moveTo/lineTo/stroke` の作法をそのまま流用する。差分は **★の3箇所だけ**：`Pose` import／`TRAIL_COLOR`／トレイル描画ブロック。

#### 全文（軌跡トレイルを追加。★が増分6の差分）
```ts
// ui.ts — Canvas にシムの世界を描く。状態・ロジックは持たない(描画だけ)。
import type { World, SimConfig } from "./sim/model";
import type { Pose } from "./types";          // ★追加: Pose は types.ts へ移設済み

/** 部屋(cm)を Canvas(px) に収める拡大率。 */
function scaleFor(canvas: HTMLCanvasElement, sc: SimConfig): number {
    return Math.min(canvas.width / sc.roomW, canvas.height / sc.roomH);
}

/** cm座標 → Canvas px座標。y は反転(奥=上 を 画面の上方向 へ)。 */
function toPx(x: number, y: number, sc: SimConfig, scale: number) {
    return { px: x * scale, py: (sc.roomH - y) * scale };
}

const ROBOT_RADIUS_PX = 6;  // 画面上のロボット表示半径
const GREY_COLOR = "#888"
const GREEN_COLOR = "#2b8a3e"
const TRAIL_COLOR = "#adb5bd"   // ★追加: 薄いグレー（本体より目立たせない）

/** 世界を1フレーム描く(部屋の枠 + 軌跡トレイル + ロボットの位置と向き)。 */
export function draw(ctx: CanvasRenderingContext2D, world: World, sc: SimConfig, trail?: Pose[]): void {  // ★trail? を追加
    const { canvas } = ctx;
    const scale = scaleFor(canvas, sc);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 部屋の枠
    ctx.strokeStyle = GREY_COLOR;
    ctx.strokeRect(0, 0, sc.roomW * scale, sc.roomH * scale);

    // ★追加: 軌跡トレイル。2点以上あるときだけ pose 列をポリラインで結ぶ。
    //   本体の「下」に敷くため、ロボット描画より前に描く。無ければ何もしない＝従来の絵。
    if (trail && trail.length >= 2) {
        ctx.strokeStyle = TRAIL_COLOR;
        ctx.beginPath();
        trail.forEach((pose, i) => {
            const { px, py } = toPx(pose.x, pose.y, sc, scale);   // 既存 toPx を流用（cm→px・y反転）
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        });
        ctx.stroke();
    }

    // ロボット本体(丸)
    const { x, y, yawDeg } = world.pose;
    const p = toPx(x, y, sc, scale);
    const r = ROBOT_RADIUS_PX;
    ctx.fillStyle = GREEN_COLOR;
    ctx.beginPath();
    ctx.arc(p.px, p.py, r, 0, Math.PI * 2);     // 半径6pxの円を描く
    ctx.fill();

    // 向きの矢印(yaw方向。画面yは下向きなので sin の符号を反転)
    const rad = (yawDeg * Math.PI) / 180;
    ctx.strokeStyle = GREEN_COLOR;
    ctx.beginPath();
    ctx.moveTo(p.px, p.py);
    ctx.lineTo(p.px + Math.cos(rad) * r * 2.5, p.py - Math.sin(rad) * r * 2.5);
    ctx.stroke();
}
```

- **後方互換**：`trail` 省略時は `if` を素通り＝**既存呼び出し `draw(ctx, world, sc)` は無改造**で同じ絵。
- **描画順**：トレイルは**本体より前**に描き、ロボットの丸/矢印が必ず上に重なる。
- sim・実機・将来のリプレイが**同じ `draw` を共有**（描画を一本化）。違いは `trail` に渡す列だけ（sim=真値／実機=推定）。

### (B) `main.ts`：ライフサイクルで配線（全文）
既存の `main.ts`（シム＋実機の二系統・`session` 委譲・緊急停止）を**保ったまま**、記録の配線を ★ で足す。`onTick` は `createRunner` 時に確定するので、**記録は module 変数 `recorder` で持ち、両 `onTick` から参照**する。`#start` で記録開始、`#save-*` で書き出し。

```ts
// main.ts — シムデモ＋実機自走の組み立て。部品を繋ぎ、ボタンに配線する。
import { defaultConfig, initialState, WS_URL, CAM_URL, defaultMotionModel, telemetryConfig } from "./config"; // ★校正値/桁を追加
import { defaultSimConfig } from "./sim/model";
import type { World } from "./sim/model";
import type { Transport } from "./io/transport";
import type { State, Sensors, Command, TrajectoryHeader } from "./types";          // ★追加
import { SimRobot } from "./sim/sim-robot";
import { createRunner } from "./runner";
import { draw } from "./ui";
import { SerialTransport } from "./io/transport";
import { WebSocketTransport } from "./io/ws-transport";
import { RobotSession } from "./session";
import { newSessionId, makeHeader } from "./telemetry/session-meta";               // ★追加
import { createTrajectory } from "./telemetry/trajectory";                        // ★追加
import { TrajectoryRecorder } from "./telemetry/recorder";                        // ★追加
import { SimPoseSource, EstimatorPoseSource } from "./telemetry/pose-source";     // ★追加
import { toNDJSON, toCSV } from "./telemetry/serialize";                          // ★追加
import { downloadText, recordingFilename } from "./telemetry/download";           // ★追加

const canvas = document.querySelector<HTMLCanvasElement>("#sim")!;
const ctx = canvas.getContext("2d")!;

// 左寄り・右向きで開始(部屋の中で適当な初期姿勢)
const initialWorld: World = {
    pose: { x: 20, y: defaultSimConfig.roomH / 2, yawDeg: 0 },
    servoDeg: defaultConfig.scanCenterDeg,
};
const simRobot = new SimRobot(initialWorld, defaultSimConfig);

// ★記録の状態。「開始」1回で1セッション。onTick から参照するので module 変数で持つ。
let recorder: TrajectoryRecorder | null = null;
let recTraj: ReturnType<typeof createTrajectory> | null = null;
let recId = "";                                       // 保存ファイル名に使う sessionId
let connSource: TrajectoryHeader["source"] = "sim";   // 接続種別(実機接続成功時に usb/wifi へ)

// ★記録中なら onTick を積み、軌跡トレイル付きで描く。未記録なら従来どおり描くだけ。
// truth: シムは真値 world を渡す／実機は無いので、記録した推定 pose から world を組んで描く。
function render(state: State, sensors: Sensors, cmd: Command, truth?: World): void {
    if (recorder && recTraj) {
        recorder.onTick(state, sensors, cmd);                              // 1tick を Trajectory に積む
        const poses = recTraj.samples().map(s => s.pose);
        const world = truth ?? { pose: poses[poses.length - 1], servoDeg: defaultConfig.scanCenterDeg };
        draw(ctx, world, defaultSimConfig, poses);                         // 既存描画＋トレイル(pose 列)
    } else if (truth) {
        draw(ctx, truth, defaultSimConfig);                               // 記録前のシム描画(従来どおり)
    }
}

const simRunner = createRunner(simRobot, defaultConfig, initialState, (state, sensors, cmd) => {
    render(state, sensors, cmd, simRobot.getWorld());     // ★sim=真値 world ＋(記録中なら)トレイル
});
draw(ctx, simRobot.getWorld(), defaultSimConfig);         // 初期状態を1回描く

// --- 実機(自走)。接続できたらここに入る ---
const session = new RobotSession();

// 緊急停止: ループを止め、実機に stop を複数回送る(25m USB で1フレーム落ちても止まるように)
async function emergencyStop(): Promise<void> {
    simRunner.stop();
    session.runner?.stop();
    for (let i = 0; i < 3; i++) {
        await session.robot?.send({ kind: "stop", speed: 0 }).catch(() => {});
    }
    console.log("■ 停止");
}

// ★開始時に記録を起こす。実機接続済みなら推定(Estimator)、未接続ならシム真値(Sim)。差はこの分岐だけ。
function beginRecording(): void {
    const isReal = !!session.runner;
    const pose0 = simRobot.getWorld().pose;               // 開始姿勢(実機も同じ座標系で擬似スタート)
    const poseSource = isReal
        ? new EstimatorPoseSource(pose0, defaultMotionModel)  // 真値不明→推測航法で推定
        : new SimPoseSource(simRobot);                        // シムの真値を覗く
    const startedAtIso = new Date().toISOString();
    recId = newSessionId(startedAtIso);                   // : と . を - に(ファイル名安全)
    const t0 = Date.now();                                // 時間軸の原点[ms]
    recTraj = createTrajectory(makeHeader({
        sessionId: recId, startedAtIso, source: isReal ? connSource : "sim",
        config: defaultConfig, motionModel: defaultMotionModel, pose0,
    }));
    recorder = new TrajectoryRecorder({
        now: Date.now, t0, poseSource, traj: recTraj,
        estimated: isReal, precision: telemetryConfig.posePrecision,   // 桁は config(ハードコードしない)
    });
}

// 開始: 実機接続済みなら実機を、未接続ならシムを走らせる(＋記録開始)
document.querySelector("#start")!.addEventListener("click", () => {
    beginRecording();                            // ★以後 onTick が Trajectory に積まれる
    (session.runner ?? simRunner).start();
});

// 停止: 緊急停止(stopを複数回送る)。ボタンもキー(Esc/Space)と同じ確実な停止にする。
document.querySelector("#stop")!.addEventListener("click", () => { void emergencyStop(); });

// キーボードでも緊急停止(Esc / Space)。暴走時の保険。
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === " ") { e.preventDefault(); void emergencyStop(); }
});

// ★保存: 直近の記録を NDJSON / CSV で書き出す(停止後にDL)。
document.querySelector("#save-ndjson")!.addEventListener("click", () => {
    if (!recorder) return;
    downloadText(recordingFilename(recId, "ndjson"), toNDJSON(recorder.finish()), "application/x-ndjson");
});
document.querySelector("#save-csv")!.addEventListener("click", () => {
    if (!recorder) return;
    downloadText(recordingFilename(recId, "csv"), toCSV(recorder.finish()), "text/csv");
});

const connectBtn = document.querySelector<HTMLButtonElement>("#connect")!;
const wifiBtn = document.querySelector<HTMLButtonElement>("#connect-wifi")!;

// USB/WiFi 共通の接続処理。Transport の開け方だけ差し替え、あとは session に委ねる。
// session.connect が「旧を stop→close してから新を張る」ので、二重接続=ゾンビ runner が生まれない。
async function connect(openTransport: () => Promise<Transport>, okMsg: string, source: TrajectoryHeader["source"]): Promise<boolean> {
    connectBtn.disabled = wifiBtn.disabled = true;      // open 中は多重クリック不可
    try {
        await session.connect(openTransport, (robot) => createRunner(
            robot, defaultConfig, initialState, (state, sensors, cmd) => {
                // 壁検知が効いているか見えるよう、距離・相・指令をログ
                console.log(`[tick] dist=${sensors.distanceCm}cm phase=${state.phase} left=${state.turnTicksLeft} cmd=${cmd.kind}`);
                render(state, sensors, cmd);            // ★記録＋推定トレイル描画(実機は truth 無し)
            }
        ));
        await session.robot?.send({ kind: "stop", speed: 0, aimDeg: defaultConfig.scanCenterDeg });
        connSource = source;                            // ★ヘッダ source 用に接続種別を保持
        console.log(okMsg);
        return true;
    } catch (e) {
        console.warn("接続失敗:", (e as Error).message);   // 失敗=未接続(安全側)。シムは使える
        return false;
    } finally {
        connectBtn.disabled = wifiBtn.disabled = false;   // 失敗でも再挑戦できるよう必ず戻す
    }
}

// USB接続: ユーザー操作内で requestPort が要るので click ハンドラ直下で開く。
connectBtn.addEventListener("click", () => {
    void connect(() => SerialTransport.open(), "実機接続OK。『開始』で自走、『停止』/Esc/Spaceで停止。", "usb");
});

// WiFi接続: WS中継経由でつなぐ。USB と違うのは Transport の開け方とカメラ表示だけ。
wifiBtn.addEventListener("click", async () => {
    const ok = await connect(() => WebSocketTransport.open(WS_URL), "WiFi接続OK。『開始』で自走、『停止』/Esc/Spaceで停止。", "wifi");
    if (ok) {
        const cam = document.querySelector<HTMLImageElement>("#cam");
        if (cam) cam.src = CAM_URL;     // カメラはWiFi接続成功時だけ表示
    }
});
```

**この全文での設計判断（★の意図）**
- **記録の境界**：`#start` で `beginRecording()` → 走行中 `render` が毎tick積む → `#save-ndjson`/`#save-csv` で書き出し。停止は既存の `emergencyStop` のまま（記録は止めず、保存はボタンで明示）。
- **sim/実機の差は `beginRecording` 内の `poseSource`・`estimated` と、描画の `truth` 有無だけ**。`recorder`・`serialize`・`download`・`runner`・`cleaning` は無改造。
- **実機は真値 world が無い**ので、記録した**推定 pose を world に詰めて** canvas に描く（トレイルも推定列）。
**要追加（配線が要求する周辺）**

**(1) `index.html`：保存ボタンを2つ足す。**
`main.ts` は `document.querySelector("#save-ndjson")!.addEventListener(...)` と**非null断定**で参照する。ボタンが無いと `querySelector` が `null` を返し、`.addEventListener` で**モジュール評価時に TypeError → 以降の接続/保存配線が全部死ぬ**（描画は throw 前なので残る）。既存のボタン `div` に2つ追加：
```html
<div>
  <button id="start">開始</button>
  <button id="stop">停止</button>
  <button id="connect">実機接続（USB）</button>
  <button id="connect-wifi">WiFi接続</button>
  <button id="save-ndjson">NDJSON保存</button>   <!-- ★追加 -->
  <button id="save-csv">CSV保存</button>          <!-- ★追加 -->
</div>
```

**(2) `config.ts`：`defaultMotionModel` / `telemetryConfig`** は **増分4（§4）** のコードブロックのとおり集約済み。`main` はそれを参照し、桁(`telemetryConfig.posePrecision`)・校正値(`defaultMotionModel`)を**ハードコードしない**。

---

## 7. テストは足りるか（十分性チェック・stage7 全体）

### 7.1 追跡（要求・不変条件 → テスト）
| ID | 要求/不変条件 | テスト | 種別 |
|---|---|---|---|
| Rq1 | sim は真値で軌跡 | pose-source(Sim)／結合 estimated=false | unit/integ |
| Rq2 | 実機は推定・`estimated=true` | pose-source(Estimator)／recorder／7b E* | unit |
| Rq3 | 毎tickを過不足なく記録 | recorder（t/dt/順序/件数） | unit |
| Rq4 | NDJSON/CSV・往復可能 | 7c serialize（往復・列セル一致）／結合 | unit/integ |
| Rq5 | 軌跡をトレイル描画 | （描画＝smoke）＋結合で pose 列が出る | smoke/integ |
| Rq9 | ハードコーディング無し | sample（桁=config）／motion-model（数値=config） | unit |
| Rq10 | runner/cleaning 無改造 | 既存 cleaning.test が緑のまま＋結合で step 流用 | regression/integ |
| INV | 純粋性・往復同一・列ズレ防止・合成・無損失 | 7a K9／7c N(往復)/C(列)／7b 正方形 | unit |

### 7.2 ユニットでは足りない領域（正直に・代替手段）
| 欠落 | なぜ単体不可 | どう埋めるか |
|---|---|---|
| `ui` トレイル描画 | canvas 副作用 | 目視＋sim smoke（DoD） |
| `main` 配線・`downloadText` | DOM/ブラウザ副作用 | 手動 smoke（DL ファイルが開けるか） |
| 実機 dt ジッタ・推定ドリフト | 物理・電圧・スリップ依存 | §7b 校正＋「推定」明示。**精度は保証しない** |
| 大量サンプルの性能/メモリ | 実走行依存 | 実機 smoke（長時間で破綻しないか） |

**結論**：軌跡ロジックは「純モジュール（7a/7b/7c）＋アプリ部品（pose-source/recorder）＋**結合テスト**」で**配線まで含めて十分**。残りは描画/DOM/実機という**本質的に非ユニットの領域**だけで、これは DoD の smoke で閉じる。「テスト緑＝パイプライン全体が正しい、描画と実機は smoke で別途確認」と切り分けられる。

---

## 8. Definition of Done（stage7 全体のゲート）
- [ ] `npm run test:run` 緑（7a〜7d の新規ユニット＋結合）／`npm run typecheck` 緑。
- [ ] Domain/telemetry の純モジュール行カバレッジ ≒100%。
- [ ] **sim**：自走させて**地図にトレイルが出る**／NDJSON・CSV をDLし**開けて往復一致**。
- [ ] **実機 smoke（USB/WiFi）**：自走しながら軌跡が出て NDJSON/CSV が落ち、**軌跡の“形”が走行と矛盾しない**（推定）。
- [ ] [current-build-spec.md](../reference/current-build-spec.md) §9 の「軌跡は推定すら未実装」を「推定で記録可」へ更新。

> 次（別stageで）：カメラ録画 = **stage8**（[design-trajectory-recording-architecture.md](../reference/design-trajectory-recording-architecture.md) §7 を TDD 化。MJPEG demux を純テスト＋プロキシ/ffmpeg は smoke）。

---
関連：[stage7a](stage7a-pose-and-kinematics.md)／[stage7b](stage7b-pose-estimation.md)／[stage7c](stage7c-trajectory-log.md)／ [design-trajectory-recording-architecture.md](../reference/design-trajectory-recording-architecture.md)（全体・カメラ設計）／ [code-design.md](code-design.md)（層分け・onTick・手足原則）／ [session.test.ts](../../app/src/session.test.ts)（注入＋fake のテスト流儀）
</content>
