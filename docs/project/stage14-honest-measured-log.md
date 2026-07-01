# 段階14：記録を「推定剥がし」で実測ログ化（嘘ゼロの記録）— B2

> **ゴール**：記録から**推定 pose と推定器**を剥がし、**実測（距離/離地/指令/時刻/phase）だけ**の正直なログにする。**ログ機能自体は残す**。
> **なぜ**：記録の中身は8項目中**7つが実測/事実**、嘘は **`pose(x,y,yaw)` だけ**（[stage13](stage13-measured-only-sensor-view.md) で表示を実測化した保存版）。全消し（B1）は実データを捨てすぎ。**推定 pose と estimator を捨てれば「100%実測の記録」が残る**。
> **要件**：**R1 を「推定軌跡の保存」→「実測ログの保存」に是正**。**R2（カメラ録画＝実映像）は残す**。R3（嘘を描かない）を**保存側にも**適用。
> **前提**：stage13 完了（表示は実測 sonar のみ・ビルド緑）。
> **原則**：消すのは **推定器＋pose だけ**。**実測ログ機構は残す**。カメラ録画は別物なので残す（混同しない）。
> **検証**：本書のコードは **tsc クリーン／全体 114 tests green／実測ログ契約テスト（CSV 列＝実測のみ・header に motionModel/pose0 無し）を実測確認済み**。

---

## 1. 記録の中身＝実測が主役（嘘は pose だけ）

`TickSample`（1tick の記録）の内訳：

| フィールド | 種別 | B2 |
|---|---|---|
| `t` `dt` | 実測（実時間） | 残す |
| `cmdKind` `speed` | 事実（送った指令） | 残す |
| **`distanceCm`** | **★実測（超音波）** | 残す |
| **`lifted`** | **★実測（離地）** | 残す |
| `phase` | 事実（掃除フェーズ） | 残す |
| **`pose {x,y,yawDeg}`** | **★推定（dead-reckoning）** | **削除** |
| `estimated` | フラグ（推定か真値か） | **削除**（全部実測なので不要） |

嘘の出どころ＝`localization/motion-model.ts`（`commandToDelta`＝**指令×モデル×dt**、測っていない）→ `pose-estimator.ts`（積分＝ドリフト）→ `pose-source.ts`（`EstimatorPoseSource`）。**この鎖と pose を切る**。

---

## 2. 削除 vs 改修（ここが B1 との違い）

| 対象 | 処置 |
|---|---|
| `localization/motion-model.ts`・`pose-estimator.ts`・`telemetry/pose-source.ts` | **削除**（純フィクション。`localization/` は空になり dir ごと削除） |
| `telemetry/`：`sample`・`serialize`・`recorder`・`recording-session`・`session-meta`・`trajectory`・`download` | **残す（pose を剥がす改修）** ＝ 実測ログ機構 |
| `main.ts` の recording 配線 | **簡素化**（poseSource/estimator を渡さない） |
| カメラ録画一式・保存ボタン | **残す** |

---

## 3. 剥がす（検証済みコード全文）

### 3.1 `types.ts`（型から pose/estimated/motionModel/pose0 を削除）
```ts
export type TickObservation = { t: number; dt: number; cmd: Command; sensors: Sensors; phase: State["phase"]; };  // pose/estimated 削除
export type TickSample      = { t: number; dt: number; cmdKind: Command["kind"]; speed: number; distanceCm: number; lifted: boolean; phase: State["phase"]; };  // pose/estimated 削除
export type TrajectoryHeader = { v: number; sessionId: string; startedAtIso: string; source: "sim" | "usb" | "wifi"; config: Config; videoFile: string | null; };  // motionModel/pose0 削除
```
※ `Pose`/`MotionModel` 型定義は残す（sim・config が使う）。

### 3.2 `telemetry/sample.ts`
```ts
// sample.ts — 観測値を1tickの記録(TickSample)に組む(純)。実測/指令/時刻のみ・pose は持たない。
import type { TickObservation, TickSample } from "../types";
export function makeSample(o: TickObservation): TickSample {
    return { t: o.t, dt: o.dt, cmdKind: o.cmd.kind, speed: o.cmd.speed, distanceCm: o.sensors.distanceCm, lifted: o.sensors.lifted, phase: o.phase };
}
```
（`precision`(pose 丸め)引数も撤去。`config.telemetryConfig.posePrecision` も不要に）

### 3.3 `telemetry/serialize.ts`（列から x/y/yawDeg/estimated 撤去）
```ts
// serialize.ts — Trajectory を NDJSON / CSV に整形(純)。列 COLUMNS は全て実測/指令/時刻。
import type { Trajectory } from "./trajectory";
const COLUMNS = ["t", "dt", "cmdKind", "speed", "distanceCm", "lifted", "phase"] as const;
export function toNDJSON(tr: Trajectory): string {
    const lines = [JSON.stringify({ type: "header", ...tr.header })];
    for (const s of tr.samples()) lines.push(JSON.stringify({ type: "tick", ...s }));
    return lines.join("\n") + "\n";
}
export function toCSV(tr: Trajectory): string {
    const rows = [COLUMNS.join(",")];
    for (const s of tr.samples()) rows.push(COLUMNS.map((c) => String(s[c])).join(","));  // pose 特例が消えて素直に
    return rows.join("\n") + "\n";
}
```

### 3.4 `telemetry/recorder.ts`（poseSource/estimated/precision 撤去）
```ts
import type { State, Sensors, Command, TickObservation } from "../types";
import type { Trajectory } from "./trajectory";
import { makeSample } from "./sample";
export class TrajectoryRecorder {
    private last: number;
    constructor(private d: { now: () => number; t0: number; traj: Trajectory }) { this.last = d.t0; }
    onTick(state: State, sensors: Sensors, cmd: Command): void {
        const now = this.d.now();
        const dt = now - this.last; this.last = now;
        const obs: TickObservation = { t: now - this.d.t0, dt, cmd, sensors, phase: state.phase };
        this.d.traj.append(makeSample(obs));
    }
    finish(): Trajectory { return this.d.traj; }
}
```

### 3.5 `telemetry/session-meta.ts`（motionModel/pose0 撤去）
```ts
import type { TrajectoryHeader, Config } from "../types";
export function newSessionId(nowIso: string): string { return nowIso.replace(/[:.]/g, "-"); }
export function makeHeader(a: { sessionId: string; startedAtIso: string; source: TrajectoryHeader["source"]; config: Config; videoFile?: string | null; }): TrajectoryHeader {
    return { v: 1, ...a, videoFile: a.videoFile ?? null };
}
```

### 3.6 `telemetry/recording-session.ts`（poseSource/estimated/motionModel/pose0/precision 撤去・`tick`→`void`）
```ts
import type { State, Sensors, Command, Config, TrajectoryHeader } from "../types";
import type { Trajectory } from "./trajectory";
import { createTrajectory } from "./trajectory";
import { TrajectoryRecorder } from "./recorder";
import { newSessionId, makeHeader } from "./session-meta";
import { toNDJSON, toCSV } from "./serialize";
import { recordingFilename } from "./download";

export type RecordingDeps = { now: () => number; nowIso: () => string; config: Config; download: (filename: string, text: string, mime: string) => void; };
export type StartArgs = { source: TrajectoryHeader["source"]; recordVideo?: boolean; };   // poseSource/estimated/motionModel/pose0 撤去

export function createRecordingSession(d: RecordingDeps) {
    let recorder: TrajectoryRecorder | null = null, traj: Trajectory | null = null, id = "";
    function save(ext: "ndjson" | "csv", to: (t: Trajectory) => string, mime: string): void {
        if (!recorder) return;
        d.download(recordingFilename(id, ext), to(recorder.finish()), mime);
    }
    return {
        get active(): boolean { return recorder !== null; },
        get sessionId(): string { return id; },
        start(a: StartArgs): void {
            const startedAtIso = d.nowIso(); id = newSessionId(startedAtIso);
            const t0 = d.now(); const videoFile = a.recordVideo ? `${id}.mp4` : null;
            traj = createTrajectory(makeHeader({ sessionId: id, startedAtIso, source: a.source, videoFile, config: d.config }));
            recorder = new TrajectoryRecorder({ now: d.now, t0, traj });
        },
        tick(state: State, sensors: Sensors, cmd: Command): void { if (recorder) recorder.onTick(state, sensors, cmd); },  // pose 列を返さない=void
        saveNDJSON(): void { save("ndjson", toNDJSON, "application/x-ndjson"); },
        saveCSV(): void { save("csv", toCSV, "text/csv"); },
    };
}
export type RecordingSession = ReturnType<typeof createRecordingSession>;
```
（`trajectory.ts`・`download.ts` は無改修。`TickSample` が痩せるだけで通る）

---

## 4. `main.ts` の配線簡素化 ＋ 隠れ結合の付け替え

- `import { SimPoseSource, EstimatorPoseSource }` 削除。`defaultMotionModel`・`telemetryConfig` の import も不要に（main では未使用化）。
- `createRecordingSession({...})` から `precision: telemetryConfig.posePrecision` を削除。
- `recording.start` を簡素化：
```ts
// before                                          after
const pose0 = simRobot.getWorld().pose;            recording.start({
recording.start({                                      source: isReal ? connSource : "sim",
    poseSource: isReal ? new EstimatorPoseSource… ,    recordVideo: videoRecordable(),
    estimated: isReal, source: …, motionModel: … ,  });
    pose0, recordVideo: videoRecordable(),
});
```
- **隠れ結合（重要）**：カメラ録画は `recStart(controlUrl, recording.sessionId)` と **記録の id を借りていた**。`sessionId` getter は残る（B2 は recording を残す）ので**そのまま動く**。※B1 と違い id 付け替え不要。
- `render(state, sensors, cmd)` は**そのまま**（`recording.tick(state,…)` が `state.phase` を実測ログに使う＝`state` は生きている）。

---

## 5. 保存されるもの＝実測ログの契約（検証済み）
- **CSV 見出し**：`t,dt,cmdKind,speed,distanceCm,lifted,phase`（**x/y/yawDeg/estimated 無し**）。
- **NDJSON header**：`v/sessionId/startedAtIso/source/config/videoFile`（**motionModel/pose0 無し**）。
- 契約テスト `telemetry/log-serialize.test.ts`（新規・検証済み）：
```ts
it("makeSample は pose/estimated を持たない", () => {
    expect(makeSample(obs(0, 48))).toEqual({ t: 0, dt: 100, cmdKind: "forward", speed: 80, distanceCm: 48, lifted: false, phase: initialState.phase });
});
it("CSV 見出しは実測列のみ", () => { expect(toCSV(tr).split("\n")[0]).toBe("t,dt,cmdKind,speed,distanceCm,lifted,phase"); });
it("NDJSON header に motionModel/pose0 が無い", () => { expect(toNDJSON(createTrajectory(header))).not.toMatch(/motionModel|pose0/); });
```

---

## 6. システムフロー（B2 後）
```
onTick(state, sensors, cmd) → render(state, sensors, cmd):
   recording.tick(state, sensors, cmd)          // ← 実測(距離/離地/指令/時刻/phase)だけ積む。pose は無い
   …sonar 描画(実測のみ)…
保存: saveNDJSON/CSV → 実測ログ(嘘ゼロ)。カメラは別に mp4(実映像)。
```

## 7. 依存関係（推定器 subsystem 消滅）
```
before: recorder ─▶ pose-source ─▶ pose-estimator ─▶ motion-model    (推定の鎖)
after : recorder ─▶ (無し)。記録は sensors/cmd/time だけを sample 化
```

## 8. テスト影響 / DoD
- **削除（ファイルごと）**：`motion-model.test`(7)・`pose-estimator.test`(5)・`pose-source.test`(2)。
- **改修（pose-free に更新）**：`recorder`・`recording-session`・`sample`・`serialize`・`session-meta`・`trajectory`・`recorder.integration` の各テスト（pose/poseSource/motionModel を除去）。§5 の `log-serialize.test.ts` が更新版の雛形（検証済み）。
- **検証実測値**：source 一式で **tsc クリーン／vitest 全体 114 green**（推定器＋旧テスト撤去後）。
- DoD：
  - [ ] `npm run typecheck` / `test:run` 緑。
  - [ ] 保存した CSV/NDJSON に **x/y/yawDeg/estimated/motionModel/pose0 が無い**・実測列だけ。
  - [ ] カメラ録画（WiFi）は従来どおり mp4 が残る（巻き込んでいない確認）。

## 9. 残すもの / 将来
- **残す**：カメラ録画一式・`config.defaultMotionModel`＋`MotionModel` 型（`simMotionFromModel` が使う）・`Pose` 型（sim）・`TrajectoryHeader` 型。
- 任意：`recordingFilename` の接頭辞 `trajectory-` は pose 無しなら `runlog-` 等が実態に合う（`download.ts` 1箇所）。
- 将来：yaw を IMU 実測で返せるようになったら、`pose` ではなく**実測 yaw 列**として復活できる（[machine-reference §9](../reference/machine-reference.md)）。

---
関連：[stage13](stage13-measured-only-sensor-view.md)（表示の実測化・本stageはその保存版）／ [stage12-camera-reconnect](stage12-camera-reconnect.md)（残すカメラ録画）
</content>
