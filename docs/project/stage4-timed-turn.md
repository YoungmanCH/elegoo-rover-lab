# 段階4：タイマ旋回 ＋ 実機自走（createRunner に SerialRobot）

> **ゴール**：シムと同じ brain・runner のまま、IO を実機(SerialRobot)に差し替えて**自走**させる。
> **設計変更**：旋回完了を **yaw ではなく tick 数**で判定する（タイマ旋回）。実機のジャイロ(MPU6050)が不安定(chip_id が 0⇄52)で、再書き込みも要る N=24 を避けるため。ルンバ的に「だいたい90度」で十分。
> **編集はあなた**。以下は before/after。コメントの括弧は半角。

---

## 0. なぜ tick で測るのか
- `cleaning.ts` の旧ロジックは `Math.abs(s.yawDeg - st.startYaw) >= st.targetDeg` で旋回完了を判定 → **yaw が必須**。
- 実機 read() は `yawDeg` を**問い合わせず常に 0**（N=24 は不採用）→ 旧ロジックだと `0 >= 90` が永遠に false ＝**壁で回り始めたら止まらない**。
- 解決：**「turnTicks 回だけ旋回して直進に戻る」**。yaw 不要。turnTicks は実機を見て「約90度」になるよう調整する1個のつまみ。

---

## 1. `app/src/types.ts` — State と Config を tick ベースに

### State（`startYaw`/`targetDeg` を削除し、`turnTicksLeft` を追加）
**Before（42-50行）:**
```ts
export type State = {
    phase: "drive" | "turn";

    /** 旋回を開始した瞬間のヨー角 [度]。turn 中だけ意味を持つ。 */
    startYaw: number;

    /** 今回の旋回で回したい角度 [度]（基本 90、ジッタを足すこともある）。 */
    targetDeg: number;
}
```
**After:**
```ts
export type State = {
    phase: "drive" | "turn";

    /** turn 中の残り tick 数。drive では 0。1 以下になった tick で直進へ戻る(タイマ旋回)。 */
    turnTicksLeft: number;
}
```

### Config（`turnDeg` を削除し、`turnTicks` を追加）
**Before（61-62行）:**
```ts
    /** 1回の旋回での目標角 [度]。 */
    turnDeg: number;
```
**After:**
```ts
    /** 1回の旋回に費やす tick 数(タイマ旋回)。旋回時間 = tickMs × turnTicks。実機で約90度になるよう調整。 */
    turnTicks: number;
```

> `Sensors.yawDeg` は**残してOK**（シムは供給、実機は 0）。brain では使わなくなるだけ。コメントを直すなら「現状の brain では未使用(タイマ旋回)」と添える程度。

---

## 2. `app/src/config.ts` — 既定値を更新

**Before（7-23行）:**
```ts
export const defaultConfig: Config = {
    wallCm: 20,
    turnDeg: 90,
    turnDir: "left",
    driveSpeed: 120,
    turnSpeed: 150,
    tickMs: 120,
}

export const initialState: State = {
    phase: "drive",
    startYaw: 0,
    targetDeg: 0,
}
```
**After:**
```ts
export const defaultConfig: Config = {
    wallCm: 20,             // 20cm より近づいたら旋回
    turnTicks: 4,           // ★タイマ旋回: 4tick 回る(tickMs=120 → 約480ms)。実機で90度になるよう調整
    turnDir: "left",        // 既定は左回り。"right" で右回り
    driveSpeed: 120,        // 直進速度
    turnSpeed: 150,         // 旋回速度
    tickMs: 120,            // 制御周期 [ms]
}

export const initialState: State = {
    phase: "drive",
    turnTicksLeft: 0,       // ★最初は旋回していない
}
```

> **turnTicks の調整**：まず 4 で走らせ、回り過ぎなら減らす(3)、足りなければ増やす(5,6…)。`turnSpeed` を下げると1tick あたりの回転が小さくなり微調整しやすい。

---

## 3. `app/src/domain/cleaning.ts` — タイマ旋回に置き換え（全文）

```ts
// cleaning.ts — 掃除の判断ロジック(純粋状態機械)。副作用なし。
//
// 入力 (Sensors, State, Config) → 出力 (Command, 次の State) を決めるだけ。
// 優先順位: 安全(持ち上げ) → 相ごとの処理(drive / turn)
// 旋回完了は「turnTicks 回まわったら」で判定(タイマ旋回)。yaw は使わない(実機ジャイロが不安定なため)。
import type { Sensors, State, Config, Command, StepResult } from "../types";

export function step(s: Sensors, st: State, cfg: Config): StepResult {
    // 旋回指令: 設定の向き(turnDir)に応じて左/右を選ぶ。開始時・継続時で共通。
    const turnCmd: Command = {
        kind: cfg.turnDir === "right" ? "rotateRight" : "rotateLeft",
        speed: cfg.turnSpeed,
    };

    // 安全ゲート: 床から離れていたら相に関係なく即停止。
    //   next は現在の相をそのまま返す＝床に戻れば中断地点から再開できる。
    if (s.lifted) {
        return { cmd: { kind: "stop", speed: 0 }, next: st };
    }

    // turn: 残り tick を1減らしながら旋回を続け、残り1tick で直進へ戻る。
    //   (yaw を使わず tick 数で測る＝ジャイロ不要。turnTicks を実機で約90度に調整)
    if (st.phase === "turn") {
        if (st.turnTicksLeft <= 1) {
            return {
                cmd: { kind: "forward", speed: cfg.driveSpeed },
                next: { phase: "drive", turnTicksLeft: 0 },
            };
        }
        return {
            cmd: turnCmd,
            next: { phase: "turn", turnTicksLeft: st.turnTicksLeft - 1 },
        };
    }

    // drive: 壁に近づくまで直進。しきい値を下回ったら旋回を開始(turnTicks をセット)し turn へ。
    if (s.distanceCm < cfg.wallCm) {
        return {
            cmd: turnCmd,
            next: { phase: "turn", turnTicksLeft: cfg.turnTicks },
        };
    }
    return { cmd: { kind: "forward", speed: cfg.driveSpeed }, next: st };
}
```

### tick の数え方（turnTicks=4 の例）
| tick | 相/残り | 出力cmd | 次state |
|---|---|---|---|
| 0 | drive・壁検知 | turn | {turn, 4} |
| 1 | turn・4 | turn | {turn, 3} |
| 2 | turn・3 | turn | {turn, 2} |
| 3 | turn・2 | turn | {turn, 1} |
| 4 | turn・1 | **forward** | {drive, 0} |

→ 旋回コマンドはちょうど **turnTicks 回**（tick0〜3）。tick4 で直進に戻る。旋回後もまだ壁が近ければ次の drive 判定でまた turn に入る(安全)。

---

## 4. `app/src/domain/cleaning.test.ts` — タイマ旋回のテストに更新（全文）

```ts
// cleaning.test.ts — step() の純ロジックを検証(タイマ旋回版)
import { describe, it, expect } from "vitest";
import { step } from "./cleaning";
import type { Sensors, State, Config } from "../types";

// テスト用センサ(必要な値だけ over で上書き。既定は「床・前方100cm・正立」)
function sensors(over: Partial<Sensors> = {}): Sensors {
    return { distanceCm: 100, yawDeg: 0, lifted: false, ...over };
}

// テスト用設定(turnTicks=3・左回りを既定に。over で上書き)
function config(over: Partial<Config> = {}): Config {
    return {
        wallCm: 20, turnTicks: 3, turnDir: "left",
        driveSpeed: 120, turnSpeed: 150, tickMs: 120, ...over,
    };
}

const drive: State = { phase: "drive", turnTicksLeft: 0 };

describe("step(タイマ旋回)", () => {
    it("drive中・壁が遠い → 直進を継続(drive のまま)", () => {
        const r = step(sensors({ distanceCm: 50 }), drive, config());
        expect(r.cmd).toEqual({ kind: "forward", speed: 120 });
        expect(r.next).toEqual({ phase: "drive", turnTicksLeft: 0 });
    });

    it("drive中・壁に到達(左回り) → 左旋回を開始し turn へ(turnTicks をセット)", () => {
        const r = step(sensors({ distanceCm: 10 }), drive, config({ turnTicks: 3 }));
        expect(r.cmd).toEqual({ kind: "rotateLeft", speed: 150 });
        expect(r.next).toEqual({ phase: "turn", turnTicksLeft: 3 });
    });

    it("drive中・壁に到達(右回り) → 右旋回を開始", () => {
        const r = step(sensors({ distanceCm: 10 }), drive, config({ turnDir: "right" }));
        expect(r.cmd.kind).toBe("rotateRight");
        expect(r.next.phase).toBe("turn");
    });

    it("turn中・残りtickあり → 旋回を継続し残りtickを1減らす", () => {
        const turning: State = { phase: "turn", turnTicksLeft: 3 };
        const r = step(sensors({ distanceCm: 10 }), turning, config());
        expect(r.cmd).toEqual({ kind: "rotateLeft", speed: 150 });
        expect(r.next).toEqual({ phase: "turn", turnTicksLeft: 2 });
    });

    it("turn中・残り1tick → 直進に戻る(drive へ)", () => {
        const turning: State = { phase: "turn", turnTicksLeft: 1 };
        const r = step(sensors({ distanceCm: 10 }), turning, config());
        expect(r.cmd).toEqual({ kind: "forward", speed: 120 });
        expect(r.next).toEqual({ phase: "drive", turnTicksLeft: 0 });
    });

    it("持ち上げ → 相に関係なく停止(相は保持)", () => {
        const turning: State = { phase: "turn", turnTicksLeft: 2 };
        const r = step(sensors({ lifted: true }), turning, config());
        expect(r.cmd).toEqual({ kind: "stop", speed: 0 });
        expect(r.next).toEqual(turning);  // 相は変えない＝床に戻れば再開
    });

    it("純粋関数: 入力の state を書き換えない", () => {
        const turning: State = { phase: "turn", turnTicksLeft: 3 };
        const snapshot = { ...turning };
        step(sensors({ distanceCm: 10 }), turning, config());
        expect(turning).toEqual(snapshot);  // 元の state は不変
    });
});
```

---

## 5. `app/src/main.ts` — 段階4：実機自走の配線（全文）

シムと**同じ runner・brain**を、IO だけ実機に差し替える。`実機接続`で接続→`開始`で自走、`停止`で止める（接続では動かさない＝安全）。

```ts
// main.ts — シムデモ＋実機自走の組み立て。部品を繋ぎ、ボタンに配線する。
import { defaultConfig, initialState } from "./config";
import { defaultSimConfig } from "./sim/model";
import type { World } from "./sim/model";
import { SimRobot } from "./sim/sim-robot";
import { createRunner } from "./runner";
import type { Runner } from "./runner";
import { draw } from "./ui";
import { SerialTransport } from "./io/transport";
import { SerialRobot } from "./io/serial-robot";

const canvas = document.querySelector<HTMLCanvasElement>("#sim")!;
const ctx = canvas.getContext("2d")!;

// --- シム(画面デモ) ---
const initialWorld: World = {
    pose: { x: 20, y: defaultSimConfig.roomH / 2, yawDeg: 0 },
};
const simRobot = new SimRobot(initialWorld, defaultSimConfig);
const simRunner = createRunner(simRobot, defaultConfig, initialState, () => {
    draw(ctx, simRobot.getWorld(), defaultSimConfig);
});
draw(ctx, simRobot.getWorld(), defaultSimConfig);  // 初期状態を1回描く

// --- 実機(自走)。接続できたらここに入る ---
let realRunner: Runner | null = null;

// 開始: 実機接続済みなら実機を、未接続ならシムを走らせる
document.querySelector("#start")!.addEventListener("click", () => {
    (realRunner ?? simRunner).start();
});

// 停止: 両方止める(動いていない方の stop は無害)
document.querySelector("#stop")!.addEventListener("click", () => {
    simRunner.stop();
    realRunner?.stop();
});

// 実機接続: ポートを開き、SerialRobot で runner を組む(まだ走らせない=安全)
document.querySelector("#connect")!.addEventListener("click", async () => {
    const tx = await SerialTransport.open();        // ★ユーザー操作内で requestPort
    const robot = new SerialRobot(tx);
    realRunner = createRunner(robot, defaultConfig, initialState, (state) => {
        console.log("[tick]", state);               // 相と残りtickを観測(簡易テレメトリ)
    });
    console.log("実機接続OK。『開始』で自走します。停止は『停止』。");
});
```

> 旧 `#connect` のスモーク(5回read＋1秒前進)は役目を終えたので、上の自走配線に置き換える。スモークで確認したいときは別ブランチ/コメントで残してもよい。

---

## 6. 走らせる前の前提（実機センサの確認）
brain はセンサ値で動くので、これが正しくないと止まる/暴れる：
1. **離地 lifted = false**：デモする床/白い紙の上で `{23_true}`(=接地) になること。`{23_false}` のままだと安全ゲートで**永久停止**。
2. **距離 distanceCm**：壁の手前で `wallCm(20)` を下回り、開けた所では 20 以上を返すこと。常に `{21_0}` だと**その場で回り続ける**(0 < 20 のため)。

→ この2つが正しく出ることを確認してから「開始」。

---

## 7. 実行・確認
```bash
cd app
npm run test:run    # cleaning(タイマ旋回) などが緑
npm run typecheck   # 型エラーが無いこと(State/Config 変更の波及を確認)
npm run dev         # Chrome で localhost
```
手順：
1. **満充電**の車を**床**に置く（離地=false・電源安定）。
2. `実機接続` → ポート選択（シリアルモニタは閉じる／二重接続しない）。
3. コンソールで `[tick]` が流れ、`{distanceCm, lifted}` が妥当か確認。
4. `開始` → 壁に近づくと旋回、離れると直進。回り過ぎ/不足なら **`config.ts` の `turnTicks`** を調整。
5. `停止` で止める。

---
関連：[stage3-code-part2.md](stage3-code-part2.md)（IO本体）／ [cleaning-logic-spec.md](cleaning-logic-spec.md)（判断ロジック）／ [code-design.md](code-design.md) §3,§5
