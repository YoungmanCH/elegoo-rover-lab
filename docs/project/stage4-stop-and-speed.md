# 段階4 追補：停止を確実にする ＋ 速度を落として旋回を見やすく

> 実機で自走できたが2つ課題：
> 1. **「停止」を押しても止まらない**。
> 2. **速すぎて壁で旋回しているのか分かりづらい**。
>
> どちらも原因がはっきりしている。編集は `runner.ts`（停止）と `config.ts`（速度）。

---

## 1. 「停止」で止まらない理由 → runner が実機に stop を送っていない

### 原因
- 前進は **N=3 (`CMD_CarControl_NoTimeLimit`)＝時間無制限**。一度送ると、次の指令が来るまで firmware は**走り続ける**。
- 今の `runner.stop()` は **setInterval を止めるだけ**で、実機に停止指令を送っていない。
- だから「停止」を押すと**ループは止まるが、最後の前進が残って車は走り続ける**。
- さらに、停止の瞬間に実行中だった tick が**後から前進指令を送ってしまう**競合もある。

### 修正：`app/src/runner.ts`
`running` フラグを足し、(a)停止後の tick は送信しない、(b)停止時に明示的に stop を送る。

**Before（21-51行 付近）:**
```ts
    let state = initial;
    let timer: ReturnType<typeof setInterval> | null = null;
    let busy = false;   // 前ティックの非同期処理が終わるまで次を始めない

    async function tick(): Promise<void> {
        if (busy) return;   // 重なり防止(実機の read/send は時間がかかる)
        busy = true;
        try {
            const sensors = await io.read();
            const { cmd, next } = step(sensors, state, cfg);
            await io.send(cmd);
            state = next;
            onTick?.(state);
        } finally {
            busy = false;
        }
    }

    return {
        start() {
            if (timer) return;  // 二重起動を防ぐ
            timer = setInterval(tick, cfg.tickMs);
        },
        stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        }
    };
```
**After:**
```ts
    let state = initial;
    let timer: ReturnType<typeof setInterval> | null = null;
    let busy = false;       // 前ティックの非同期処理が終わるまで次を始めない
    let running = false;    // 停止後に「居残りの tick」が指令を送るのを防ぐ

    async function tick(): Promise<void> {
        if (busy || !running) return;   // 重なり防止＋停止後は何もしない
        busy = true;
        try {
            const sensors = await io.read();
            const { cmd, next } = step(sensors, state, cfg);
            if (!running) return;        // 停止が押されていたら送らない
            await io.send(cmd);
            state = next;
            onTick?.(state);
        } finally {
            busy = false;
        }
    }

    return {
        start() {
            if (timer) return;  // 二重起動を防ぐ
            running = true;
            timer = setInterval(tick, cfg.tickMs);
        },
        stop() {
            running = false;
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            // ループを止めるだけでは実機は最後の前進(N=3 は時間無制限)で走り続ける。
            // 明示的に stop を送って必ず止める。
            void io.send({ kind: "stop", speed: 0 });
        }
    };
```

> これで「停止」を押すと、(1)以後の tick は送信しない、(2)即座に stop 指令が飛ぶ＝**確実に止まる**。シムでも無害（その場で止まるだけ）。

---

## 2. 速すぎて旋回が見えない → 速度を落とし、壁を早めに検知

### 修正：`app/src/config.ts`
**Before:**
```ts
export const defaultConfig: Config = {
    wallCm: 20,
    turnTicks: 4,
    turnDir: "left",
    driveSpeed: 120,
    turnSpeed: 150,
    tickMs: 120,
    liftStop: false,
}
```
**After:**
```ts
export const defaultConfig: Config = {
    wallCm: 30,             // 壁の手前30cmで旋回開始(早めに曲がる＝見やすい・ぶつかり余裕)
    turnTicks: 6,           // 旋回をゆっくりにした分、約90度に必要なtick数を増やす(要実機調整)
    turnDir: "left",
    driveSpeed: 70,         // 直進をゆっくり(観察しやすい・壁検知に余裕)
    turnSpeed: 90,          // 旋回もゆっくり(1tickの回転が小さく観察しやすい)
    tickMs: 120,
    liftStop: false,
}
```

### 調整の勘所
- **遅すぎて動かない/回らないとき**：PWM が低すぎてモーターのトルク不足。`driveSpeed`/`turnSpeed` を **+10〜20** 上げる（床がカーペットなら特に）。まず動く下限を探す。
- **旋回が90度にならない**：`turnTicks` で合わせる。回り過ぎ→減らす、足りない→増やす。`turnSpeed` を一定にして `turnTicks` だけ動かすと調整が楽。
- **壁にぶつかってから曲がる**：`wallCm` を上げる（30→40）。速度を下げたので 30 でも余裕は出るはず。
- これらは全部 **`config.ts` の1か所**だけ。ロジック（cleaning.ts）は触らない。

---

## 確認
```bash
cd app
npm run test:run    # runner は副作用なので主に型/既存テストが緑であること
npm run typecheck
npm run dev
```
1. 床で `実機接続` → `開始`。**ゆっくり前進 → 壁手前30cmで旋回 → また前進**が見えるか。
2. `停止` で**その場で止まる**か（走り続けないか）。
3. 旋回角は `turnTicks`、速度は `driveSpeed`/`turnSpeed`、曲がるタイミングは `wallCm` で微調整。

---
関連：[stage4-timed-turn.md](stage4-timed-turn.md) / [stage4-lift-bypass.md](stage4-lift-bypass.md)
