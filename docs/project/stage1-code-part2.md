# 段階1 コード草案（第二弾：`cleaning.test.ts` / `cleaning.ts`）

> **位置づけ**：第一弾（[stage1-code.md](stage1-code.md) の `types.ts` / `config.ts`）の上に、掃除の判断ロジック本体を載せる。レビュー用草案 → OKで実ファイル `app/src/domain/` に落とす。
> **TDD の順**：先に `cleaning.test.ts`（仕様を実行可能な形で書く）→ それを通す `cleaning.ts`。だから**テストを先に読む**。
> 参照：[cleaning-logic-spec.md](cleaning-logic-spec.md) ／ [code-design.md](code-design.md)
> **更新**：旋回方向 `turnDir`（左/右）に対応。左右両方をテスト。コメントの丸カッコは半角 `()` に統一。

---

## 1. `app/src/domain/cleaning.test.ts` — 先に書くテスト（＝仕様）

`step()` に期待する振る舞いを、状態×入力の組み合わせで固定する。
**ポイント：テストは自前の `cfg` を持つ**。`defaultConfig` を import しないのは、実機チューニングで `config.ts` の数値を変えても**ロジックのテストが壊れないようにする**ため（テストは「値」ではなく「振る舞い」を守る）。

```ts
// cleaning.test.ts — step() の振る舞い仕様(Vitest)
import { describe, it, expect } from "vitest";
import { step } from "./cleaning";
import type { Sensors, State, Config } from "../types";

// テスト専用の固定パラメータ。config.ts の調整と切り離す(振る舞いだけを検証)。
// 既定は左回り。右回りは個々のテストで { ...cfg, turnDir: "right" } と上書きする。
const cfg: Config = {
  wallCm: 20, turnDeg: 90, turnDir: "left", driveSpeed: 120, turnSpeed: 150, tickMs: 120,
};

// センサのビルダ:既定は「床にいて・壁は遠い・正面向き」。必要な項目だけ上書き。
function sensors(over: Partial<Sensors> = {}): Sensors {
  return { distanceCm: 100, yawDeg: 0, lifted: false, ...over };
}

const driveState: State = { phase: "drive", startYaw: 0, targetDeg: 0 };

describe("step", () => {
  it("持ち上げられたら、どの相でも stop(安全が最優先)", () => {
    const r = step(sensors({ lifted: true }), driveState, cfg);
    expect(r.cmd).toEqual({ kind: "stop", speed: 0 });
    expect(r.next).toEqual(driveState); // 相は保持(床に戻れば再開できる)
  });

  it("drive中・壁が遠い → 前進し、状態は変わらない", () => {
    const r = step(sensors({ distanceCm: 50 }), driveState, cfg);
    expect(r.cmd).toEqual({ kind: "forward", speed: cfg.driveSpeed });
    expect(r.next).toEqual(driveState);
  });

  it("drive中・しきい値ちょうど(20cm)は『まだ遠い』扱い → 前進", () => {
    // 判定は distanceCm < wallCm。境界(==)は旋回しない、を固定する。
    const r = step(sensors({ distanceCm: cfg.wallCm }), driveState, cfg);
    expect(r.cmd.kind).toBe("forward");
  });

  it("drive中・壁に到達(左回り) → 左旋回を開始し turn相へ(startYaw=現在のyaw)", () => {
    const r = step(sensors({ distanceCm: 10, yawDeg: 30 }), driveState, cfg);
    expect(r.cmd).toEqual({ kind: "rotateLeft", speed: cfg.turnSpeed });
    expect(r.next).toEqual({ phase: "turn", startYaw: 30, targetDeg: cfg.turnDeg });
  });

  it("drive中・壁に到達(右回り) → 右旋回を開始し turn相へ", () => {
    const rightCfg: Config = { ...cfg, turnDir: "right" };
    const r = step(sensors({ distanceCm: 10, yawDeg: 30 }), driveState, rightCfg);
    expect(r.cmd).toEqual({ kind: "rotateRight", speed: cfg.turnSpeed });
    expect(r.next).toEqual({ phase: "turn", startYaw: 30, targetDeg: cfg.turnDeg });
  });

  it("turn中・目標角に未達(左回り) → 左旋回を継続(状態そのまま)", () => {
    const turning: State = { phase: "turn", startYaw: 0, targetDeg: 90 };
    const r = step(sensors({ yawDeg: 45 }), turning, cfg);
    expect(r.cmd).toEqual({ kind: "rotateLeft", speed: cfg.turnSpeed });
    expect(r.next).toEqual(turning);
  });

  it("turn中・目標角に未達(右回り) → 右旋回を継続", () => {
    const rightCfg: Config = { ...cfg, turnDir: "right" };
    const turning: State = { phase: "turn", startYaw: 0, targetDeg: 90 };
    const r = step(sensors({ yawDeg: 45 }), turning, rightCfg);
    expect(r.cmd).toEqual({ kind: "rotateRight", speed: cfg.turnSpeed });
  });

  it("turn中・目標角に到達 → 前進に戻り drive相へ", () => {
    const turning: State = { phase: "turn", startYaw: 0, targetDeg: 90 };
    const r = step(sensors({ yawDeg: 90 }), turning, cfg);
    expect(r.cmd).toEqual({ kind: "forward", speed: cfg.driveSpeed });
    expect(r.next.phase).toBe("drive");
  });

  it("純粋関数:入力の state を書き換えない", () => {
    const before: State = { phase: "drive", startYaw: 0, targetDeg: 0 };
    const snapshot = { ...before };
    step(sensors({ distanceCm: 5 }), before, cfg);
    expect(before).toEqual(snapshot); // 破壊的変更が無いこと
  });
});
```

---

## 2. `app/src/domain/cleaning.ts` — テストを通す実装

`step(s, st, cfg)` は **判断だけ**する純関数。I/O・JSON変換・タイマーは持たない（それぞれ `io` / `protocol` / `runner` の責務）。
旋回の左右は `cfg.turnDir` で決め、**1か所で組み立てて使い回す**（drive→turn の開始時と turn 継続時で同じ向きになる）。

```ts
// cleaning.ts — 掃除の判断ロジック(純粋状態機械)。副作用なし。
//
// 入力 (Sensors, State, Config) → 出力 (Command, 次の State) を決めるだけ。
// 優先順位: ①安全(持ち上げ) → ②相ごとの処理(drive / turn)
import type { Sensors, State, Config, Command, StepResult } from "../types";

export function step(s: Sensors, st: State, cfg: Config): StepResult {
  // 旋回指令: 設定の向き(turnDir)に応じて左/右を選び、開始時・継続時で共通に使う。
  const turnCmd: Command = {
    kind: cfg.turnDir === "right" ? "rotateRight" : "rotateLeft",
    speed: cfg.turnSpeed,
  };

  // ① 安全ゲート:床から離れていたら相に関係なく即停止。
  //    next は現在の相をそのまま返す＝床に戻れば中断地点から再開できる。
  if (s.lifted) {
    return { cmd: { kind: "stop", speed: 0 }, next: st };
  }

  // ② drive:壁に近づくまで直進。しきい値を下回ったら旋回を開始し turn へ遷移。
  if (st.phase === "drive") {
    if (s.distanceCm < cfg.wallCm) {
      return {
        cmd: turnCmd,
        // 旋回開始時の向きを startYaw に記録。これが turn の判定基準になる。
        next: { phase: "turn", startYaw: s.yawDeg, targetDeg: cfg.turnDeg },
      };
    }
    return { cmd: { kind: "forward", speed: cfg.driveSpeed }, next: st };
  }

  // ② turn:開始時の向き(startYaw)から targetDeg ぶん回ったら直進へ戻る。
  // 注意: 旋回は1tickずつ離散的に進むため、閾値をまたいだ次のtickで止まる＝必ず1tickぶんオーバー。
  //       例(シム 約4.7度/tick): 19tick=89.4度(<90→継続) / 20tick=94.1度(>=90→停止) → 約4度行き過ぎ。
  //       実用上は問題なし。直角に寄せたいなら1tickの回転角を小さく(turnSpeed↓)。
  if (Math.abs(s.yawDeg - st.startYaw) >= st.targetDeg) {
    return {
      cmd: { kind: "forward", speed: cfg.driveSpeed },
      next: { ...st, phase: "drive" }, // startYaw/targetDeg は drive では未使用
    };
  }
  return { cmd: turnCmd, next: st };
}
```

---

## ⚠ 既知の限界（今は直さない・段階2以降で対処）

**ヨー角の折り返し（wrap-around）**：`Math.abs(s.yawDeg - st.startYaw)` は単純な引き算。実機の MPU6050 が ±180° で折り返す値を返す場合、例えば `startYaw=170°` から旋回して `yawDeg=-170°`（実際は20°回っただけ）になると差が 340° と誤判定され、**旋回が即終了してしまう**。左回り・右回りどちらでも起きる。

- 今回の第一弾は spec の単純版に忠実にしておく（＝シンプル優先・まず通す）。
- 段階2のシムでは **yaw を折り返さない連続値**で与えるので、この問題は出ない＝ロジックの検証は先に進められる。
- 実機接続（段階3）の前に、差分を `((Δ+540)%360)-180` で正規化する小ヘルパを足して解消する予定。**この限界は認識済み**として明記しておく。

---

## 配置と実行

```
app/src/domain/
├── cleaning.ts
└── cleaning.test.ts
```

```bash
cd app
npm install        # 初回のみ
npm run test:run   # 単体テスト(1回実行)
npm run typecheck  # 型チェック
```

OKなら実ファイルに落として段階1を commit。次は **段階2（`sim/model.ts` ＋テスト → `sim-robot.ts` → `runner.ts` → `ui.ts`：シム上で掃除が動く）**。
