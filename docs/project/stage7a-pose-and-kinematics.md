# 段階7a：姿勢(Pose)と運動学カーネル — TDDの土台

> **ゴール**：軌跡の土台＝**姿勢 `Pose`** と「移動量・回転量 → 新 Pose」の**運動学カーネル `integratePose`** を用意する。シムの `advance()` をこのカーネルへ**委譲**し、**シム(真値)と実機(推定)が同じ運動方程式を共有**する（モデルベース）。
> **TDDの作法（本シリーズ共通）**：1増分ずつ「**①テストを先に書く(RED) → ②最小実装(GREEN) → ③リファクタ**」。本書のコードは設計スケッチ。手を動かす順序そのものを書く。
> **前提**：[stage6](stage6-scan-and-reverse.md) まで（未実装でも可）。本書は**現行 `types.ts`**（`Command = forward|rotateLeft|rotateRight|stop`）に対して書く。全体設計は [design-trajectory-recording-architecture.md](../reference/design-trajectory-recording-architecture.md)。
> **このstageの位置**：7a(本書) → [7b 推定](stage7b-pose-estimation.md) → [7c 軌跡ログ](stage7c-trajectory-log.md) → [7d 結線・保存・描画](stage7d-recorder-and-ui.md)。
> **編集はあなた**。括弧は半角。

---

## 0. この回の増分（順に）

| # | 増分 | 種別 | テスト |
|---|---|---|---|
| 1 | `Pose` を `types.ts` へ移設 | リファクタ | 新規なし（既存緑を確認） |
| 2 | `domain/kinematics.ts` の `integratePose` | 新規・純 | **先に書く** |
| 3 | `sim/model.ts` の `advance()` をカーネルへ委譲 | リファクタ | 既存 `model.test.ts` 緑のまま |

---

## 1. 増分1：`Pose` を `types.ts` へ移設（リファクタ）

`Pose` は sim 専用ではなく**core 値オブジェクト**（推定でも軌跡でも使う）。DDD的に契約の置き場（`types.ts`）へ移す。

- **before**：`app/src/sim/model.ts` に `export type Pose = {...}`。
- **after**：`app/src/types.ts` に移し、`sim/model.ts` は `import type { Pose } from "../types";` してそのまま使う。`ui.ts` / `sim/model.test.ts` の import も `../types` 起点へ向け替え。

```ts
// types.ts に追記（x,y は cm / yawDeg は度・0=+x・反時計回りが +）
export type Pose = { x: number; y: number; yawDeg: number };
```

> **TDD観点**：型の移動は**振る舞いを変えない**＝新テスト不要。判定は「`npm run test:run` が**緑のまま**」。これも立派なリファクタ（**緑の下で動かす**）。移設後に型エラー（import 切れ）が出たら直すだけ。

---

## 2. 増分2：`integratePose`（運動学カーネル）

### ① テストを先に書く（RED）
`app/src/domain/kinematics.test.ts`
```ts
// kinematics.test.ts — 運動学カーネルの振る舞い仕様。実装より先に書く。
import { describe, it, expect } from "vitest";
import { integratePose } from "./kinematics";   // ← まだ無い。この import 解決失敗で RED
import type { Pose } from "../types";

const pose = (x: number, y: number, yawDeg: number): Pose => ({ x, y, yawDeg });

describe("integratePose（回転→並進の純粋カーネル）", () => {
    it("yaw=0 で前進 → +x に move ぶん進む(向き不変)", () => {
        expect(integratePose(pose(10, 75, 0), 10, 0)).toEqual({ x: 20, y: 75, yawDeg: 0 });
    });

    it("後退(move 負) → 逆向きへ", () => {
        expect(integratePose(pose(10, 75, 0), -10, 0)).toEqual({ x: 0, y: 75, yawDeg: 0 });
    });

    it("回転のみ(move=0) → yaw だけ増える(位置不変)", () => {
        expect(integratePose(pose(10, 75, 0), 0, 30)).toEqual({ x: 10, y: 75, yawDeg: 30 });
    });

    it("回転してから前進(順序: 先に回る)", () => {
        const r = integratePose(pose(10, 75, 0), 10, 90);   // 90度回って +y へ
        expect(r.yawDeg).toBe(90);
        expect(r.x).toBeCloseTo(10);
        expect(r.y).toBeCloseTo(85);
    });

    it("壁でクランプしない(部屋を知らない=sim の責務)", () => {
        expect(integratePose(pose(195, 75, 0), 100, 0).x).toBe(295);   // 200 を越えても止めない
    });

    it("yaw は折り返さない(連続値)", () => {
        expect(integratePose(pose(0, 0, 350), 0, 30).yawDeg).toBe(380);
    });

    it("純粋関数: 入力 pose を破壊しない", () => {
        const p = pose(10, 75, 0);
        const snap = { ...p };
        integratePose(p, 10, 45);
        expect(p).toEqual(snap);
    });
});
```
→ `npm run test:run`：`kinematics.ts` 不在で**赤**。これがTDDの出発点。

### ② 最小実装でGREEN
`app/src/domain/kinematics.ts`
```ts
// kinematics.ts — 2D 剛体の運動学(純)。「回転 turnDeg → 向き後の前方へ moveCm」を適用するだけ。
// 壁での停止はここでは扱わない(部屋を持つ sim 側の責務)。シムも推定器もこの1式を共有する。
import type { Pose } from "../types";

export function integratePose(pose: Pose, moveCm: number, turnDeg: number): Pose {
    const yawDeg = pose.yawDeg + turnDeg;          // 先に回す
    const rad = (yawDeg * Math.PI) / 180;
    return {
        x: pose.x + Math.cos(rad) * moveCm,        // 回った後の向きへ進む
        y: pose.y + Math.sin(rad) * moveCm,
        yawDeg,
    };
}
```
→ 全テスト**緑**。

---

## 3. 増分3：`advance()` をカーネルへ委譲（リファクタ）

運動方程式の重複を消し、モデルを単一正本にする。**新テストは書かない**——既存 `model.test.ts` が**緑のまま**であることが「振る舞い不変」の証明（＝TDDの REFACTOR フェーズ）。

`app/src/sim/model.ts`
```ts
import { integratePose } from "../domain/kinematics";

// before の cos/sin 直書きをやめ、カーネル＋壁クランプに分解する。
export function advance(w: World, cmd: Command, sc: SimConfig): World {
    if (cmd.kind === "forward") {
        const move = (cmd.speed / 255) * sc.maxDriveCmPerTick;
        const p = integratePose(w.pose, move, 0);
        return { pose: { x: clamp(p.x, 0, sc.roomW), y: clamp(p.y, 0, sc.roomH), yawDeg: p.yawDeg } };  // ★壁クランプは sim だけ
    }
    if (cmd.kind === "rotateLeft" || cmd.kind === "rotateRight") {
        const a = (cmd.speed / 255) * sc.maxTurnDegPerTick;
        const dir = cmd.kind === "rotateLeft" ? 1 : -1;
        return { pose: integratePose(w.pose, 0, dir * a) };
    }
    return w;  // stop
}
```
→ `npm run test:run`：**既存 model.test.ts が緑のまま**＝OK。
> （[stage6](stage6-scan-and-reverse.md) を適用済みなら `reverse` と `servoDeg` も同じ要領でカーネルへ委譲する。）

---

## 4. テストは足りるか（十分性チェック）

| 観点 | 確認 |
|---|---|
| **分岐網羅** | `integratePose` は分岐ゼロ（常に回転＋並進の1経路）。`move=0`/`turn=0`/両方非ゼロの組合せで前進のみ・回転のみ・複合を網羅。 |
| **境界値** | yaw=0/90/180/350、move 負（後退方向）、turn で 380（折り返さない）、座標 295（クランプしない）。 |
| **不変条件** | 純粋性（入力 pose 不変）／**クランプしない**＝sim との責務分離を明示テスト。 |
| **カバレッジ** | `kinematics.ts` 行カバレッジ 100%（純・1経路）。`advance` はリファクタ＝既存 `model.test.ts` が回帰で担保。 |
| **不足と対処** | 浮動小数の**累積**誤差は1tickでは出ない → [7b](stage7b-pose-estimation.md) の「正方形経路」メタモルフィックテストで連続合成を検証する。 |

**結論**：本回のロジック（運動学カーネル）はテストで十分。`advance` の振る舞い不変は既存テストが保証する。

---
関連：[design-trajectory-recording-architecture.md](../reference/design-trajectory-recording-architecture.md)（全体設計・DDD層）／ [code-design.md](code-design.md)（純粋核・依存逆転）／ [stage7b](stage7b-pose-estimation.md)（次：推定）／ [stage6](stage6-scan-and-reverse.md)（直近の状態）
</content>
