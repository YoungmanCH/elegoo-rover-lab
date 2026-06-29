# 段階7b：影 dead-reckoning（推定の現在地）— TDD

> **ゴール**：実機の「**推定の現在地**」を出す影推定器を TDD で作る。`指令 + 実dt → 移動量(commandToDelta) → Pose(integratePose)`。エンコーダが無いので**ドリフトする＝推定**（UIで必ず明示）。
> **モデルベース**：[7a](stage7a-pose-and-kinematics.md) の運動学カーネルを再利用。シム(真値)と実機(推定)で同じ式。
> **前提**：[7a](stage7a-pose-and-kinematics.md) 完了（`integratePose` / `Pose` in `types.ts`）。本書は現行 `Command = forward|rotateLeft|rotateRight|stop` に対して書く。
> **このstageの位置**：[7a](stage7a-pose-and-kinematics.md) → 7b(本書) → [7c](stage7c-trajectory-log.md) → [7d](stage7d-recorder-and-ui.md)。
> **編集はあなた**。括弧は半角。

---

## 0. この回の増分

| # | 増分 | 種別 | テスト |
|---|---|---|---|
| 1 | `MotionModel` 型（`types.ts`） | 型追加 | — |
| 2 | `localization/motion-model.ts` の `commandToDelta` | 新規・純 | **先に書く** |
| 3 | `localization/pose-estimator.ts` の `estimateStep` | 新規・純 | **先に書く**（合成検証つき） |

> **ハードコーディング排除**：校正値（cm/s・deg/s）は `MotionModel` に閉じ込め、ロジックは**引数で受ける**（`cleaning.ts` の `cfg` と同じ作法）。実体は [7d](stage7d-recorder-and-ui.md) で `config.ts` に集約。

---

## 1. 増分1：`MotionModel` 型（`types.ts` に追記）

```ts
/** PWM→物理量の校正（推定の唯一の根拠。値は config.ts で集約）。 */
export type MotionModel = {
    driveCmPerSec: number;   // forward(driveSpeed) の実速度[cm/s]。要実測(§4)
    turnDegPerSec: number;   // rotate(turnSpeed) の実角速度[deg/s]。要実測(§4)
    refDriveSpeed: number;   // 上記 cm/s を測った前進PWM(速度スケール基準)
    refTurnSpeed: number;    // 上記 deg/s を測った旋回PWM
};
```
> （[stage6](stage6-scan-and-reverse.md) の `reverse` を入れたら `reverseCmPerSec` を足し、§2 の `commandToDelta` に `case "reverse"` を1つ追加する。）

---

## 2. 増分2：`commandToDelta`（校正：指令＋実dt → 移動量/回転量）

### ① テストを先に書く（RED）
`app/src/localization/motion-model.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { commandToDelta } from "./motion-model";        // ← まだ無い。RED
import type { MotionModel, Command } from "../types";

const mm = (over: Partial<MotionModel> = {}): MotionModel => ({
    driveCmPerSec: 20, turnDegPerSec: 90, refDriveSpeed: 80, refTurnSpeed: 100, ...over,
});
const cmd = (kind: Command["kind"], speed: number): Command => ({ kind, speed });

describe("commandToDelta（dt と速度で移動量を決める）", () => {
    it("forward・基準速・dt=1000ms → moveCm=driveCmPerSec, turnDeg=0", () => {
        expect(commandToDelta(cmd("forward", 80), 1000, mm())).toEqual({ moveCm: 20, turnDeg: 0 });
    });
    it("rotateLeft → turnDeg 正・moveCm=0", () => {
        expect(commandToDelta(cmd("rotateLeft", 100), 1000, mm())).toEqual({ moveCm: 0, turnDeg: 90 });
    });
    it("rotateRight → turnDeg 負", () => {
        expect(commandToDelta(cmd("rotateRight", 100), 1000, mm()).turnDeg).toBeCloseTo(-90);
    });
    it("stop → {0,0}", () => {
        expect(commandToDelta(cmd("stop", 0), 1000, mm())).toEqual({ moveCm: 0, turnDeg: 0 });
    });
    it("dt 線形: dt 2倍 → 量も2倍", () => {
        expect(commandToDelta(cmd("forward", 80), 2000, mm()).moveCm).toBeCloseTo(40);
    });
    it("速度スケール: 基準の半分のPWM → 量も半分", () => {
        expect(commandToDelta(cmd("forward", 40), 1000, mm()).moveCm).toBeCloseTo(10);
    });
});
```
→ `npm run test:run`：**赤**。

### ② 最小実装でGREEN
`app/src/localization/motion-model.ts`
```ts
// motion-model.ts — 指令と実経過 dt から「この間の移動量cm・回転量deg」を出す(純)。
// 速度(PWM)は基準値に対して線形と近似(ラフ。校正で吸収)。数値は MotionModel から受ける。
import type { Command, MotionModel } from "../types";

export function commandToDelta(cmd: Command, dtMs: number, m: MotionModel): { moveCm: number; turnDeg: number } {
    const sec = dtMs / 1000;
    switch (cmd.kind) {
        case "forward":
            return { moveCm: m.driveCmPerSec * (cmd.speed / m.refDriveSpeed) * sec, turnDeg: 0 };
        case "rotateLeft":
            return { moveCm: 0, turnDeg: +m.turnDegPerSec * (cmd.speed / m.refTurnSpeed) * sec };
        case "rotateRight":
            return { moveCm: 0, turnDeg: -m.turnDegPerSec * (cmd.speed / m.refTurnSpeed) * sec };
        case "stop":
            return { moveCm: 0, turnDeg: 0 };
    }
}
```
→ 緑。`switch` は現行 `Command` 全種を網羅（exhaustive）。**stage6 で `reverse` が増えると TS が未網羅を指摘**してくれる＝TDDの安全網。

---

## 3. 増分3：`estimateStep`（影 dead-reckoning の1tick）

### ① テストを先に書く（RED）
`app/src/localization/pose-estimator.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { estimateStep } from "./pose-estimator";        // ← まだ無い。RED
import type { Pose, MotionModel, Command } from "../types";

const mm: MotionModel = { driveCmPerSec: 20, turnDegPerSec: 90, refDriveSpeed: 80, refTurnSpeed: 100 };
const fwd: Command = { kind: "forward", speed: 80 };
const left: Command = { kind: "rotateLeft", speed: 100 };
const origin: Pose = { x: 0, y: 0, yawDeg: 0 };

describe("estimateStep（commandToDelta → integratePose の合成）", () => {
    it("forward → 向きへ前進", () => {
        expect(estimateStep(origin, fwd, 1000, mm).x).toBeCloseTo(20);
    });
    it("rotateLeft → yaw だけ増える", () => {
        const r = estimateStep(origin, left, 1000, mm);
        expect(r.yawDeg).toBeCloseTo(90);
        expect(r.x).toBeCloseTo(0);
    });
    it("stop → 不変", () => {
        expect(estimateStep({ x: 5, y: 6, yawDeg: 7 }, { kind: "stop", speed: 0 }, 1000, mm))
            .toEqual({ x: 5, y: 6, yawDeg: 7 });
    });
    it("正方形: [前進→左90度]×4 で始点へ戻る(連続合成の検証)", () => {
        let p = origin;
        for (let i = 0; i < 4; i++) {
            p = estimateStep(p, fwd, 1000, mm);    // 20 進む
            p = estimateStep(p, left, 1000, mm);   // 90度回る
        }
        expect(p.x).toBeCloseTo(0);
        expect(p.y).toBeCloseTo(0);
        expect(p.yawDeg).toBeCloseTo(360);
    });
    it("純粋: 入力 pose 不変", () => {
        const p = { ...origin };
        estimateStep(p, fwd, 1000, mm);
        expect(p).toEqual(origin);
    });
});
```
→ **赤**。

### ② 最小実装でGREEN
`app/src/localization/pose-estimator.ts`
```ts
// pose-estimator.ts — 影 dead-reckoning。指令+実dt で Pose を1tick進める(純)。
// モデルベース: commandToDelta(校正) → integratePose(運動学カーネル)。ドリフトする=推定。
import type { Pose, Command, MotionModel } from "../types";
import { commandToDelta } from "./motion-model";
import { integratePose } from "../domain/kinematics";

export function estimateStep(pose: Pose, cmd: Command, dtMs: number, m: MotionModel): Pose {
    const { moveCm, turnDeg } = commandToDelta(cmd, dtMs, m);
    return integratePose(pose, moveCm, turnDeg);
}
```
→ 緑。

---

## 4. テストは足りるか（十分性チェック）

| 観点 | 確認 |
|---|---|
| **分岐網羅** | `commandToDelta` の `switch` 全 case（forward/left/right/stop）に対応テスト＝完全網羅。 |
| **境界・関係** | dt 線形（2倍→2倍）／速度スケール（半分→半分）／stop=0。 |
| **合成の正しさ** | `estimateStep` は**正方形経路（メタモルフィック）**で連続合成を検証＝個別caseで漏れる「回転と並進の順序バグ」を捕捉。 |
| **不変条件** | 両関数の純粋性。 |
| **カバレッジ** | `motion-model.ts` / `pose-estimator.ts` 行カバレッジ 100%（純）。 |
| **ユニット不能・別手段** | 実機の `driveCmPerSec`/`turnDegPerSec` の**真値**はテスト不能 → §校正で実測。**ドリフト量は推定の性質上保証しない**（UI/ログで「推定」明示）。 |

**結論**：推定ロジックは分岐網羅＋関係性＋合成＋純粋性で十分。残るのは「校正値の正しさ」だけで、それは実測（下記）で詰める。

---

## 5. 校正（実機・満充電で）
- `driveCmPerSec`：`driveSpeed` PWM で一定距離を走らせ、巻尺＋ストップウォッチで cm/s を実測（目標 20〜30cm/s、[research-roomba-speed-and-motion](../reference/research-roomba-speed-and-motion.md)）。
- `turnDegPerSec`：1回転にかかる時間から deg/s を実測（目標 60〜120°/s）。
- `refDriveSpeed`/`refTurnSpeed`：実測した時の PWM をそのまま入れる。
- **dt は名目 `tickMs` でなく実測経過**を使う（[7d](stage7d-recorder-and-ui.md) の recorder が `now()` 差分で供給）。WiFi は往復で tick が伸びるため。
- 値の置き場は [7d](stage7d-recorder-and-ui.md) で `config.ts` に集約。

---
関連：[stage7a](stage7a-pose-and-kinematics.md)（運動学カーネル）／ [stage7c](stage7c-trajectory-log.md)（次：軌跡ログ）／ [design-trajectory-recording-architecture.md](../reference/design-trajectory-recording-architecture.md)／ [research-roomba-speed-and-motion.md](../reference/research-roomba-speed-and-motion.md)（目標値）
</content>
