# 段階4 追補：緊急停止を確実に ＋ 壁検知の誤判定を修正

> 課題2つ：
> 1. **「停止」が効かない（安全に直結・最優先）**。
> 2. **壁をちゃんと検知できていない**（旋回はするが壁と無関係に見える）。
>
> 2 の原因は firmware で確定：超音波は **エコーが返らない＝前方に何も無い時に `0` を返す**（`DeviceDriverSet_xxx0.cpp:286` `pulseIn(ECHO_PIN,HIGH)/58`、タイムアウトで 0）。さらに 150cm 超は 150 にクランプ。
> → 今のロジック `distanceCm < wallCm(30)` は **`0`（遠い／壁なし）を「壁」と誤判定**して旋回していた。これが「壁検知が変」の正体。

---

# A. 緊急停止を確実にする（最優先・安全）

## A-1. なぜ効かないか
- 前進は **N=3（時間無制限）**＝次の指令まで走り続ける。
- ループ(runner)を止めるだけでは実機に stop が届かない＋停止の瞬間に**実行中の tick が後から前進を送る**競合もある。
- 25m USB で **stop が1フレーム落ちる**可能性もある。

## A-2. `app/src/runner.ts`（全文に置き換え）
`running` フラグで居残り送信を止め、`stop()` で必ず stop を送る。観測用に `onTick` へ**センサと指令も渡す**（壁検知の可視化に使う）。

```ts
// runner.ts — 制御ループ。tick ごとに read→step→send を回し、State を持ち回す。
import type { RobotIO } from "./io/robot";
import type { Config, State, Sensors, Command } from "./types";
import { step } from "./domain/cleaning";

export type Runner = {
    start(): void;
    stop(): void;
}

export function createRunner(
    io: RobotIO,
    cfg: Config,
    initial: State,
    onTick?: (state: State, sensors: Sensors, cmd: Command) => void,
): Runner {
    let state = initial;
    let timer: ReturnType<typeof setInterval> | null = null;
    let busy = false;       // 前ティックの非同期処理が終わるまで次を始めない
    let running = false;    // 停止後に「居残りの tick」が指令を送るのを防ぐ

    async function tick(): Promise<void> {
        if (busy || !running) return;       // 重なり防止＋停止後は何もしない
        busy = true;
        try {
            const sensors = await io.read();
            const { cmd, next } = step(sensors, state, cfg);
            if (!running) return;            // 停止が押されていたら送信しない
            await io.send(cmd);
            state = next;
            onTick?.(state, sensors, cmd);   // 観測(描画/テレメトリ)用にセンサ・指令も渡す
        } finally {
            busy = false;
        }
    }

    return {
        start() {
            if (timer) return;               // 二重起動を防ぐ
            running = true;
            timer = setInterval(tick, cfg.tickMs);
        },
        stop() {
            running = false;
            if (timer) { clearInterval(timer); timer = null; }
            // ループ停止だけでは実機は最後の前進(N=3 は時間無制限)で走り続ける。明示的に止める。
            void io.send({ kind: "stop", speed: 0 });
        }
    };
}
```

## A-3. `app/src/main.ts`（全文に置き換え）
緊急停止を関数化し、**stop を複数回送る**＋**Esc / Space キーでも停止**。テレメトリで**距離をログ**して壁検知を可視化。

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
const initialWorld: World = { pose: { x: 20, y: defaultSimConfig.roomH / 2, yawDeg: 0 } };
const simRobot = new SimRobot(initialWorld, defaultSimConfig);
const simRunner = createRunner(simRobot, defaultConfig, initialState, () => {
    draw(ctx, simRobot.getWorld(), defaultSimConfig);
});
draw(ctx, simRobot.getWorld(), defaultSimConfig);  // 初期状態を1回描く

// --- 実機 ---
let realRunner: Runner | null = null;
let realRobot: SerialRobot | null = null;   // 緊急停止で直接 stop を送るため保持

// 緊急停止: ループを止め、実機に stop を複数回送る(25m USB で1フレーム落ちても止まるように)
async function emergencyStop(): Promise<void> {
    simRunner.stop();
    realRunner?.stop();
    for (let i = 0; i < 3; i++) {
        await realRobot?.send({ kind: "stop", speed: 0 }).catch(() => {});
    }
    console.log("■ 停止");
}

document.querySelector("#start")!.addEventListener("click", () => {
    (realRunner ?? simRunner).start();       // 実機接続済みなら実機、未接続ならシム
});
document.querySelector("#stop")!.addEventListener("click", () => { void emergencyStop(); });

// キーボードでも緊急停止(Esc / Space)。暴走時の保険。
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === " ") { e.preventDefault(); void emergencyStop(); }
});

// 実機接続: ポートを開き、SerialRobot で runner を組む(まだ走らせない=安全)
document.querySelector("#connect")!.addEventListener("click", async () => {
    const tx = await SerialTransport.open();          // ★ユーザー操作内で requestPort
    realRobot = new SerialRobot(tx);
    realRunner = createRunner(realRobot, defaultConfig, initialState, (state, sensors, cmd) => {
        // 壁検知が効いているか見えるよう、距離・相・指令をログ
        console.log(`[tick] dist=${sensors.distanceCm}cm phase=${state.phase} left=${state.turnTicksLeft} cmd=${cmd.kind}`);
    });
    console.log("実機接続OK。『開始』で自走、『停止』またはEsc/Spaceで停止。");
});
```

> これで停止は：(1)以後の tick は送らない、(2)stop を3回送る、(3)ボタンでもキーでも発火。**確実に止まる**。

---

# B. 壁検知の誤判定を修正（`0` を壁としない）

## B-1. `app/src/domain/cleaning.ts`（drive ブロックだけ変更）
**Before:**
```ts
    // drive: 壁に近づくまで直進。しきい値を下回ったら旋回を開始(turnTicks をセット)し turn へ。
    if (s.distanceCm < cfg.wallCm) {
        return {
            cmd: turnCmd,
            next: { phase: "turn", turnTicksLeft: cfg.turnTicks },
        };
    }
    return { cmd: { kind: "forward", speed: cfg.driveSpeed }, next: st };
```
**After:**
```ts
    // drive: 壁に近づくまで直進。「正の距離で wallCm 未満」のときだけ旋回。
    //   distanceCm == 0 は「エコー無し＝前方に何も無い(遠い)」(firmware: pulseIn タイムアウトで 0)。
    //   0 を壁扱いすると開けた場所で誤旋回するので、0 は壁としない。
    const wallAhead = s.distanceCm > 0 && s.distanceCm < cfg.wallCm;
    if (wallAhead) {
        return {
            cmd: turnCmd,
            next: { phase: "turn", turnTicksLeft: cfg.turnTicks },
        };
    }
    return { cmd: { kind: "forward", speed: cfg.driveSpeed }, next: st };
```

## B-2. `app/src/domain/cleaning.test.ts`（テスト1件追加）
```ts
    it("drive中・距離0(エコー無し=遠い) → 壁とみなさず直進", () => {
        const r = step(sensors({ distanceCm: 0 }), drive, config());
        expect(r.cmd).toEqual({ kind: "forward", speed: 120 });
        expect(r.next.phase).toBe("drive");
    });
```

> 既存の「壁に到達」テストは `distanceCm: 10`（0 より大・wallCm 未満）なので従来通り旋回で通る。

---

# C. 確認手順
```bash
cd app
npm run test:run    # cleaning に距離0ケース追加で緑
npm run typecheck   # runner の onTick シグネチャ変更の波及を確認
npm run dev
```
1. 床で `実機接続` → コンソールに `[tick] dist=..cm phase=.. cmd=..` が流れる。
2. **手を超音波の前にかざす/外す** → `dist` が小さくなる/`150`や大きい値になるのを確認（センサが前を見ているか）。
3. `開始` → **開けた所では前進（`dist` が大 or 150）**、**壁手前で `dist` が wallCm(30) 未満になった瞬間に旋回**、を `[tick]` ログで確認。
4. `停止`／`Esc`／`Space` で**即停止**。

### まだ壁検知が怪しいとき
- `[tick]` の `dist` を見て、**壁に近づくと実際に数値が下がるか**を確認。下がらない＝超音波サーボが前を向いていない可能性 → 起動時 `DeviceDriverSet_Servo_Init(90)` で中央のはずだが、ずれていれば N=5 サーボ指令で 90 度に向ける対応を追加できる（必要なら別途）。
- `0` と `150` はどちらも「遠い/壁なし」。壁は **1〜(wallCm-1) の正の値**で検知される。

---
関連：[stage4-timed-turn.md](stage4-timed-turn.md) / [stage4-lift-bypass.md](stage4-lift-bypass.md) / [stage4-stop-and-speed.md](stage4-stop-and-speed.md)
