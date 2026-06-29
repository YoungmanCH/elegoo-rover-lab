# 段階7d：記録の結線・保存・描画 — TDD（仕上げ）

> **ゴール**：[7a〜7c](stage7c-trajectory-log.md) の純部品を「**onTick で記録するアプリ部品 `TrajectoryRecorder`**」に束ね、**真値/推定の差し替え（`PoseSource`）・保存（download）・地図トレイル（ui）・配線（main/config）**まで通す。ここで初めて副作用（DOM・時計）が登場するので、**注入でテスト可能**にする（`session.test.ts` の fake 流儀）。
> **前提**：[7a](stage7a-pose-and-kinematics.md)／[7b](stage7b-pose-estimation.md)／[7c](stage7c-trajectory-log.md) 完了。`runner.ts` / `domain/cleaning.ts` は**無改造**。
> **このstageの位置**：[7a](stage7a-pose-and-kinematics.md) → [7b](stage7b-pose-estimation.md) → [7c](stage7c-trajectory-log.md) → 7d(本書)。
> **編集はあなた**。括弧は半角。

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

const mm: MotionModel = { driveCmPerSec: 20, turnDegPerSec: 90, refDriveSpeed: 80, refTurnSpeed: 100 };
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
import type { Pose, Command, MotionModel } from "../types";
import { estimateStep } from "../localization/pose-estimator";

export interface PoseSource { next(cmd: Command, dtMs: number): Pose; }

export class SimPoseSource implements PoseSource {
    constructor(private sim: { getWorld(): { pose: Pose } }) {}
    // 真値。cmd/dt は使わないが、PoseSource と同じ引数で宣言する(具象型経由で next(cmd,dt) と呼ぶため)。
    // 引数は未使用なので _ 前缀にして noUnusedParameters を満たす。
    next(_cmd: Command, _dtMs: number): Pose { return this.sim.getWorld().pose; }
}

export class EstimatorPoseSource implements PoseSource {
    constructor(private pose: Pose, private m: MotionModel) {}
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
const state: State = { phase: "drive", turnTicksLeft: 0 };
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
import type { State, Sensors, Command } from "../types";
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
        this.d.traj.append(makeSample(
            { t: now - this.d.t0, dt, cmd, sensors, phase: state.phase, pose, estimated: this.d.estimated },
            this.d.precision,
        ));
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
    driveCmPerSec: 22,                  // driveSpeed の実速度。要実測。目標20〜30cm/s
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
        const sim = new SimRobot({ pose: { x: 20, y: 75, yawDeg: 0 } }, defaultSimConfig);
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

純ロジックは尽きた。ここは副作用なので**ユニットせず smoke**（正直に）。

- **`ui.ts`**：`draw(ctx, world, sc, trail?)` に**任意引数 `trail: Pose[]`** を足し、あればポリラインで結ぶ（無ければ現状どおり）。シム・実機・将来のリプレイで同じ描画を共有。
- **`main.ts`**：接続/開始時に
  - `sessionId = newSessionId(new Date().toISOString())`、`t0 = Date.now()`、`makeHeader(...)` で Trajectory を作る。
  - **sim**：`poseSource = new SimPoseSource(simRobot)`、`estimated:false`。
  - **実機（USB/WiFi）**：`poseSource = new EstimatorPoseSource(pose0, defaultMotionModel)`、`estimated:true`。
  - `recorder = new TrajectoryRecorder({ now: Date.now, t0, poseSource, traj, estimated, precision: telemetryConfig.posePrecision })`。
  - **`onTick` 内で `recorder.onTick(state, sensors, cmd)` を呼び、`draw(..., traj.samples().map(s=>s.pose))` でトレイル描画**（`runner` は無改造のまま、`main` 側のコールバックで合成）。
  - **停止時**：`downloadText(recordingFilename(sessionId,"ndjson"), toNDJSON(recorder.finish()), "application/x-ndjson")`（CSV ボタンも同様）。

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
