# 段階6e：スキャンの状態機械 — 首振り→空いた方へ／行き止まりは後退+180

> **ゴール**：6dの判断 `chooseEscape` を使い、**壁検知→首を左右に振って測る→空いた方へ曲がる／両側塞がりは少し後退して180度**を状態機械として実装する。**要件③と④を挙動としてまとめて達成**。
> **設計の肝**：判断は6dに委譲済み。本段は `cleaning.ts` の相 **drive→scanLeft→scanRight→{turn|reverse}→drive** を繋ぎ、判断の3択（左/右/後退）に1対1で分岐するだけ。判断が使う `openCm` 等の**値**もここ（実際に `cfg` を渡す側）で `defaultConfig` に足す。**settle待ちは無し**（ファーム500ms整定＝[6c §0](stage6c-servo-aiming.md)）。
> **TDDの作法**：型/configを足す → `cleaning` の遷移を「テスト→実装」→ 結合(sim)で通し確認。
> **前提**：[6d](stage6d-escape-decision.md)（`chooseEscape`/`TurnDir`）＋[6b](stage6b-reverse-command.md)（後退コマンド）＋[6c](stage6c-servo-aiming.md)（サーボ配線）。
> **このstageの位置**：[6a](stage6a-slowdown.md)→[6b](stage6b-reverse-command.md)→[6c](stage6c-servo-aiming.md)→[6d](stage6d-escape-decision.md)→**6e(本書)**。
> **編集はあなた**。括弧は半角。

---

## 0. この回の増分

| # | 増分 | 種別 | テスト |
|---|---|---|---|
| 1 | `types`：`Phase`／`State` 拡張 ／ `config`：scan/openCm/reverse の値・`initialState` | 型/config | — |
| 2 | `domain/cleaning.ts`：スキャン状態機械（全文置換） | 純 | **先に書く（遷移）** |
| 3 | 結合：`cleaning.integration.test.ts` | 純結合 | **先に書く** |

---

## 1. 増分1：型・config

### `types.ts`
```ts
/** 制御の相。drive=直進 / scanLeft|scanRight=首振り測定 / turn=旋回 / reverse=後退。 */
export type Phase = "drive" | "scanLeft" | "scanRight" | "turn" | "reverse";
```
`State`（Before→After）。`turnDir` は6dの `TurnDir` を使う：
```ts
// Before
export type State = { phase: "drive" | "turn"; turnTicksLeft: number; }
// After
export type State = {
    phase: Phase;
    turnTicksLeft: number;
    /** scanLeft で測った左距離[cm]。未測定 -1。 */
    leftCm: number;
    /** scan で決めた今回の旋回向き(reverse後の180も含む)。 */
    turnDir: TurnDir;
    /** reverse 中の残り tick。 */
    reverseTicksLeft: number;
}
```
`Config` にスキャン角・空き閾値・後退値を追加（`scanCenterDeg` は6cで追加済み）。`openCm`/`turnDir` を持つので `Config` はそのまま `EscapeParams` として `chooseEscape` に渡せる：
```ts
    /** 首を左/右に向ける角度[度]。10の倍数。体の左右の向きと一致させること。 */
    scanLeftDeg: number;
    scanRightDeg: number;
    /** これ以上(or 0=エコー無し)で「空き」と見なす距離[cm]。wallCm より大きく。 */
    openCm: number;
    /** 後退の速度。 */
    reverseSpeed: number;
    /** 両側塞がり時に後退する tick 数。 */
    reverseTicks: number;
    /** 180度旋回の tick 数(≒turnTicks×2)。 */
    turnTicks180: number;
```
### `config.ts`
```ts
// defaultConfig に追加
scanLeftDeg: 150,   // 左を見る角度(体の左。サーボの向きが逆の個体は 30 と入れ替える)
scanRightDeg: 30,   // 右を見る角度
openCm: 30,         // wallCm(20) より大きく
reverseSpeed: 80,
reverseTicks: 3,    // ≒360ms 後退
turnTicks180: 12,   // ≒turnTicks×2。実機で約180度になるよう校正

// initialState を拡張
export const initialState: State = {
    phase: "drive",
    turnTicksLeft: 0,
    leftCm: -1,            // ← 追加
    turnDir: "left",       // ← 追加
    reverseTicksLeft: 0,   // ← 追加
}
```

## 2. 増分2：`domain/cleaning.ts`（全文置換）

各scan相は**1tick**（首は前tickの送信で向き、ファーム500msで整定済み）。`scanRight` で `chooseEscape` の3択に分岐する。

### ② GREEN — `cleaning.ts`（全文）
```ts
// cleaning.ts — 相の遷移と指令生成だけ(純粋)。逃げ方の判断は scan-decision に委譲。
// drive→scanLeft→scanRight→{turn|reverse}→drive。yaw 不使用(tick基準)。settle無し(ファーム500ms整定)。
import type { Sensors, State, Config, Command, StepResult, TurnDir } from "../types";
import { chooseEscape } from "./scan-decision";

export function step(s: Sensors, st: State, cfg: Config): StepResult {
    const fwd: Command = { kind: "forward", speed: cfg.driveSpeed };
    const stop: Command = { kind: "stop", speed: 0 };
    const rot = (d: TurnDir, aimDeg?: number): Command =>
        ({ kind: d === "left" ? "rotateLeft" : "rotateRight", speed: cfg.turnSpeed, aimDeg });

    // 安全ゲート: 離地で停止(相は保持＝床に戻れば再開)。
    if (cfg.liftStop && s.lifted) return { cmd: stop, next: st };

    switch (st.phase) {
        // 直進: 壁を見つけたら首を左へ向け、停止して scanLeft へ。
        case "drive": {
            const wallAhead = s.distanceCm > 0 && s.distanceCm < cfg.wallCm;
            if (!wallAhead) return { cmd: fwd, next: st };
            return { cmd: { ...stop, aimDeg: cfg.scanLeftDeg },
                     next: { ...st, phase: "scanLeft", leftCm: -1 } };
        }
        // 左を見た(整定済み): 左距離を記録し、首を右へ向けて scanRight へ。
        case "scanLeft":
            return { cmd: { ...stop, aimDeg: cfg.scanRightDeg },
                     next: { ...st, phase: "scanRight", leftCm: s.distanceCm } };
        // 右を見た(整定済み): 逃げ方を決める。Config は openCm/turnDir を持つので EscapeParams として渡せる。
        case "scanRight": {
            const escape = chooseEscape(st.leftCm, s.distanceCm, cfg);  // "left"|"right"|"reverse"
            if (escape === "reverse")
                return { cmd: { kind: "reverse", speed: cfg.reverseSpeed, aimDeg: cfg.scanCenterDeg },
                         next: { ...st, phase: "reverse", reverseTicksLeft: cfg.reverseTicks, turnDir: cfg.turnDir } };
            return { cmd: rot(escape, cfg.scanCenterDeg),               // escape は left|right に絞られる
                     next: { ...st, phase: "turn", turnDir: escape, turnTicksLeft: cfg.turnTicks } };
        }
        // 後退: reverseTicks 回下がってから180度旋回へ。
        case "reverse":
            if (st.reverseTicksLeft <= 1)
                return { cmd: rot(st.turnDir), next: { ...st, phase: "turn", turnTicksLeft: cfg.turnTicks180 } };
            return { cmd: { kind: "reverse", speed: cfg.reverseSpeed },
                     next: { ...st, reverseTicksLeft: st.reverseTicksLeft - 1 } };
        // 旋回: turnTicks(90度) or turnTicks180(180度) 回まわって直進へ。
        case "turn":
            if (st.turnTicksLeft <= 1)
                return { cmd: fwd, next: { ...st, phase: "drive", turnTicksLeft: 0 } };
            return { cmd: rot(st.turnDir), next: { ...st, turnTicksLeft: st.turnTicksLeft - 1 } };

        // 全 Phase を処理した型保証。Phase を増減するとここがコンパイルエラーになり気付ける。
        default: { const _exhaustive: never = st.phase; return { cmd: stop, next: st }; }
    }
}
```
> `escape === "reverse"` を先に返すので、その後の `rot(escape, ...)` で `escape` は `"left" | "right"`（=`TurnDir`）に**型が絞られる**。

### ① RED — `cleaning.test.ts`（全文置換）
`cleaning` は判断・速度・角度を総合する**司令塔**なので、テスト helper は `Config` 一式を渡す（こちらは全フィールドが正当に使われる）。並びは `step` の分岐順。
```ts
// cleaning.test.ts — 相の遷移と指令生成(首振りスキャン版)
import { describe, it, expect } from "vitest";
import { step } from "./cleaning";
import type { Sensors, State, Config } from "../types";

const sensors = (o: Partial<Sensors> = {}): Sensors => ({ distanceCm: 100, yawDeg: 0, lifted: false, ...o });
const config = (o: Partial<Config> = {}): Config => ({
    wallCm: 20, turnTicks: 6, turnDir: "left", driveSpeed: 80, turnSpeed: 100, tickMs: 120, liftStop: false,
    scanCenterDeg: 90, scanLeftDeg: 150, scanRightDeg: 30, openCm: 30,
    reverseSpeed: 80, reverseTicks: 3, turnTicks180: 12, ...o,
});
const drive = (o: Partial<State> = {}): State =>
    ({ phase: "drive", turnTicksLeft: 0, leftCm: -1, turnDir: "left", reverseTicksLeft: 0, ...o });

describe("step(スキャン状態機械)", () => {
    // drive
    it("壁が遠い → forward(継続)", () => {
        const r = step(sensors({ distanceCm: 50 }), drive(), config());
        expect(r.cmd).toEqual({ kind: "forward", speed: 80 });
        expect(r.next.phase).toBe("drive");
    });
    it("距離0(エコー無し) → 壁とみなさず forward", () => {
        expect(step(sensors({ distanceCm: 0 }), drive(), config()).cmd.kind).toBe("forward");
    });
    it("壁 → 停止して首を左へ・scanLeft へ", () => {
        const r = step(sensors({ distanceCm: 10 }), drive(), config());
        expect(r.cmd).toEqual({ kind: "stop", speed: 0, aimDeg: 150 });
        expect(r.next).toMatchObject({ phase: "scanLeft", leftCm: -1 });
    });
    // scanLeft
    it("左を測ったら記録して首を右へ・scanRight へ", () => {
        const r = step(sensors({ distanceCm: 55 }), drive({ phase: "scanLeft" }), config());
        expect(r.cmd).toEqual({ kind: "stop", speed: 0, aimDeg: 30 });
        expect(r.next).toMatchObject({ phase: "scanRight", leftCm: 55 });
    });
    // scanRight: chooseEscape の結果で分岐。実装と同じく「両塞→後退」を先に。
    it("両側とも壁 → 後退して reverse相へ・首は正面へ戻す", () => {
        const r = step(sensors({ distanceCm: 12 }), drive({ phase: "scanRight", leftCm: 10 }), config());
        expect(r.cmd).toEqual({ kind: "reverse", speed: 80, aimDeg: 90 });
        expect(r.next).toMatchObject({ phase: "reverse", reverseTicksLeft: 3, turnDir: "left" });
    });
    it("左が空き右が壁 → 左へ旋回開始・首は正面へ戻す", () => {
        const r = step(sensors({ distanceCm: 10 }), drive({ phase: "scanRight", leftCm: 80 }), config());
        expect(r.cmd).toEqual({ kind: "rotateLeft", speed: 100, aimDeg: 90 });
        expect(r.next).toMatchObject({ phase: "turn", turnDir: "left", turnTicksLeft: 6 });
    });
    it("右が空き左が壁 → 右へ旋回", () => {
        const r = step(sensors({ distanceCm: 80 }), drive({ phase: "scanRight", leftCm: 10 }), config());
        expect(r.cmd.kind).toBe("rotateRight");
        expect(r.next).toMatchObject({ phase: "turn", turnDir: "right" });
    });
    // reverse
    it("後退の残りが2以上 → 後退を続ける", () => {
        const r = step(sensors(), drive({ phase: "reverse", reverseTicksLeft: 3 }), config());
        expect(r.cmd.kind).toBe("reverse");
        expect(r.next.reverseTicksLeft).toBe(2);
    });
    it("後退の残りが1以下 → 180度旋回へ(turnTicks180)", () => {
        const r = step(sensors(), drive({ phase: "reverse", reverseTicksLeft: 1, turnDir: "left" }), config());
        expect(r.cmd.kind).toBe("rotateLeft");
        expect(r.next).toMatchObject({ phase: "turn", turnTicksLeft: 12 });
    });
    // turn
    it("旋回の残りが2以上 → 続ける / 1以下 → forward(drive復帰)", () => {
        expect(step(sensors(), drive({ phase: "turn", turnTicksLeft: 6, turnDir: "left" }), config()).next.turnTicksLeft).toBe(5);
        expect(step(sensors(), drive({ phase: "turn", turnTicksLeft: 1, turnDir: "left" }), config()).cmd.kind).toBe("forward");
    });
    // 横断: 安全ゲート(step の先頭で判定)・純粋性
    it("離地(liftStop) → どの相でも停止・相は保持", () => {
        const st = drive({ phase: "scanRight", leftCm: 40 });
        const r = step(sensors({ lifted: true }), st, config({ liftStop: true }));
        expect(r.cmd).toEqual({ kind: "stop", speed: 0 });
        expect(r.next).toEqual(st);
    });
    it("入力 state を壊さない(純粋)", () => {
        const st = drive({ phase: "turn", turnTicksLeft: 6, turnDir: "left" });
        const snap = structuredClone(st);
        step(sensors({ distanceCm: 10 }), st, config());
        expect(st).toEqual(snap);
    });
});
```

### 両側塞がりの tick 表（reverseTicks=3 / turnTicks180=12）
| 局面 | 出力 | 次 |
|---|---|---|
| scanRight・両塞 | reverse(1)+首正面 | reverse, 残3 |
| reverse 残3→2 | reverse(2),(3) | 残1 |
| reverse 残1 | rotate(180開始) | turn, 残12 |
| turn 残12→1 | rotate×11 → forward | drive |

→ **後退ちょうど3回 → 約180度 → 直進復帰**。

## 3. 増分3：結合（実機なし）— `domain/cleaning.integration.test.ts`（新規・全文）

`step()`＋シム物理をループで回し、**同じ brain がシム上で破綻しないか**を確認する。
```ts
import { describe, it, expect } from "vitest";
import { step } from "./cleaning";
import { initialState, defaultConfig } from "../config";
import { advance, readSensors, defaultSimConfig } from "../sim/model";
import type { World, SimConfig } from "../sim/model";

function run(w0: World, ticks: number, sc: SimConfig = defaultSimConfig) {
    let st = initialState, w = w0;
    const log: { x: number; y: number; phase: string }[] = [];
    for (let i = 0; i < ticks; i++) {
        const { cmd, next } = step(readSensors(w, sc), st, defaultConfig);
        w = advance(w, cmd, sc); st = next;
        log.push({ x: w.pose.x, y: w.pose.y, phase: st.phase });
    }
    return { log, sc };
}

describe("結合: 同じ brain をシムで回す", () => {
    it("広い部屋: 壁を貫通しない・首振りする・直進に戻り続ける(500tick)", () => {
        const { log, sc } = run({ pose: { x: 20, y: 75, yawDeg: 0 }, servoDeg: 90 }, 500);
        for (const p of log) {
            expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(sc.roomW);
            expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(sc.roomH);
        }
        expect(log.some(p => p.phase === "scanLeft")).toBe(true);                 // 壁で首振り
        expect(log.filter(p => p.phase === "drive").length).toBeGreaterThan(50);  // 直進にも居る
    });

    it("細い行き止まり: 突き当りで後退(reverse)して脱出する", () => {
        // 幅30の廊下を奥(+y)へ。突き当り付近で左右とも ~17cm(<openCm=30) → 両側塞がり → reverse。
        // 速度80=1.25cm/tick。y=10→突き当り判定(y>roomH-wallCm=60)まで約40tick。120tickで余裕。
        const sc: SimConfig = { ...defaultSimConfig, roomW: 30, roomH: 80 };
        const { log } = run({ pose: { x: 15, y: 10, yawDeg: 90 }, servoDeg: 90 }, 120, sc);
        expect(log.some(p => p.phase === "reverse")).toBe(true);
    });
});
```
> シムは `servoForwardDeg` で首角を反映し左右レイキャストを返す（[6c](stage6c-servo-aiming.md)）。整定はシムで即時＝settle無しでも一致。

---

## 4. 実行・確認
```bash
cd app
npm run test:run    # cleaning(遷移・両塞→reverse) / integration(広い部屋・行き止まり) が緑
npm run typecheck   # Phase/State 変更の波及・default never が緑に戻ること
npm run dev         # シムで壁→首振り→空いた方へ。細い行き止まりで後退→反転
```

## 5. 充足と完了条件
| 対象 | テスト | 担保する挙動 |
|---|---|---|
| 遷移(drive→scanLeft→scanRight→turn→drive・0=空き・離地・純粋性) | cleaning.test | 首振り→空いた方へ |
| 両側とも壁→reverse→180→drive | cleaning.test ×3 | 行き止まり脱出 |
| 結合(壁貫通なし・首振り発生・行き止まり後退) | integration ×2 | 通し挙動 |

- **手動（N1〜N7）**：[インデックス §4](stage6-scan-and-reverse.md) のチェックリスト。特に `scanLeftDeg` の左右・約180度・行き止まり誤検出。
- 完了：全自動テスト緑＋typecheck緑＋実機で「壁で首振り→空いた方へ／行き止まりは後退→180度」。

## 6. 段階6 完了後
- [current-build-spec.md](../reference/current-build-spec.md) を新挙動へ更新（§3/§4/§8）。
- [vision-autonomy-and-cleaning-roadmap.md](../reference/vision-autonomy-and-cleaning-roadmap.md) §3.1「超音波スイープ」「詰まり脱出」に done。

---
関連：[stage6 インデックス](stage6-scan-and-reverse.md)／ [6d 逃げ方の判断](stage6d-escape-decision.md)／ [6b 後退コマンド](stage6b-reverse-command.md)／ [cleaning-logic-spec.md](cleaning-logic-spec.md)
