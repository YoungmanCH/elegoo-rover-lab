# 段階4 追補：離地ゲートを config で無効化（実機で自走させる）

> **背景（実機ログで判明）**：自走させると車が1ミリも動かなかった。原因は離地センサの誤判定。
> - **距離は正常** … `{21_33}` `{21_32}` を返す（超音波OK）。
> - **離地が誤判定** … 床なのに `{23_false}`（= 我々の decode で `lifted: true`）。
> - その結果、brain が毎tick 安全ゲートで stop（`{"H":"4","N":4,"D1":0,"D2":0}`）を送り続け、`[tick] {phase:'drive', turnTicksLeft:0}` のまま動かない。
>
> **方針**：実機の離地センサ(裏のIR)がこの床面を検知できない＆ firmware の N=3 はそもそも離地で止めない。よって **brain 側の離地停止を config で切れる**ようにし、既定 OFF にする。安全機能は残しつつ、実機デモでは無効化できる形。

編集は4ファイル・小さな差分。コメントの括弧は半角。

---

## ① `app/src/types.ts` — Config に `liftStop` を追加
`Config` 型の末尾（`tickMs` の下あたり）に1項目追加：
```ts
    /** 離地(持ち上げ)で安全停止するか。実機の離地センサが床を誤検知する場合は false に。 */
    liftStop: boolean;
```

---

## ② `app/src/config.ts` — defaultConfig に既定値
`defaultConfig` に1行追加（既定は OFF）：
```ts
export const defaultConfig: Config = {
    wallCm: 20,
    turnTicks: 4,
    turnDir: "left",
    driveSpeed: 120,
    turnSpeed: 150,
    tickMs: 120,
    liftStop: false,        // ★実機の離地センサが不安定なので既定OFF(firmware も N=3 は離地で止めない)
}
```

---

## ③ `app/src/domain/cleaning.ts` — 安全ゲートを条件付きに
**Before:**
```ts
    // 安全ゲート: 床から離れていたら相に関係なく即停止。
    if (s.lifted) {
        return { cmd: { kind: "stop", speed: 0 }, next: st };
    }
```
**After:**
```ts
    // 安全ゲート: 離地で停止(cfg.liftStop が true のときだけ)。実機センサ不安定時は config で無効化。
    //   next は現在の相をそのまま返す＝床に戻れば中断地点から再開できる。
    if (cfg.liftStop && s.lifted) {
        return { cmd: { kind: "stop", speed: 0 }, next: st };
    }
```

---

## ④ `app/src/domain/cleaning.test.ts` — テストを追従
`config()` ヘルパに `liftStop: false` を足し、**離地テストだけ** `liftStop: true` を渡す。

**config() ヘルパ:**
```ts
function config(over: Partial<Config> = {}): Config {
    return {
        wallCm: 20, turnTicks: 3, turnDir: "left",
        driveSpeed: 120, turnSpeed: 150, tickMs: 120, liftStop: false, ...over,
    };
}
```

**離地テスト（`config({ liftStop: true })` にする）:**
```ts
    it("持ち上げ → 停止(liftStop=true のとき・相は保持)", () => {
        const turning: State = { phase: "turn", turnTicksLeft: 2 };
        const r = step(sensors({ lifted: true }), turning, config({ liftStop: true }));
        expect(r.cmd).toEqual({ kind: "stop", speed: 0 });
        expect(r.next).toEqual(turning);  // 相は変えない
    });
```

> 既定 `liftStop: false` なので、他のテスト（drive/turn 系）は `lifted` を無視して従来通り通る。離地停止の挙動だけ明示的に `liftStop: true` で検証する形。

---

## これで起きること
離地を無視するので：
- 距離 ≥ `wallCm(20)` → **前進**（今 32cm なので前進する）。
- 距離 < 20（壁手前）→ **旋回**（turnTicks 回）。

→ **床に置いて「開始」→ 壁で曲がりながら走る**はず。曲がり過ぎ/不足は `config.ts` の `turnTicks`(4→3 や 5)で調整。

## 確認
```bash
cd app
npm run test:run    # 緑(離地テストは liftStop:true で通る)
npm run typecheck   # Config に liftStop 追加の波及を確認
npm run dev
```
1. 満充電の車を**床**に置く。
2. `実機接続` → `開始`。
3. コンソールで `[tick]` の `phase` が drive↔turn で動き、車が前進→壁で旋回するか。

> 離地安全を戻したいとき（将来）：`config.ts` の `liftStop` を `true` に。実機の離地センサが床を正しく `{23_true}` と返せる床面/しきい値であることが前提。

---
関連：[stage4-timed-turn.md](stage4-timed-turn.md)（タイマ旋回＋自走配線）
