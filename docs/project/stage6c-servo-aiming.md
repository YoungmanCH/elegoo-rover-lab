# 段階6c：サーボ首振りの配線 — `aimDeg` を通す（土台・infra）

> **ゴール**：指令で**超音波の首(サーボZ)を向けられる**ようにする。`Command.aimDeg` を足し、protocol・IO送信順・シム物理まで通す。**ブレインはまだ首を振らない**（6dで使用）。要件③の配線。
> **TDDの作法**：infra＝完全テスト可能。protocol/serial-robot(送信順)/sim を「①テスト(RED)→②実装(GREEN)」。`cleaning.ts` は**無変更**。World型変更は**既存テスト緑を保つリファクタ**。
> **前提**：[6b](stage6b-reverse-command.md) まで。**ファーム裏取りが本段の肝**（下記§0）。
> **このstageの位置**：[6a](stage6a-slowdown.md) → [6b](stage6b-reverse-command.md) → **6c(本書)** → [6d](stage6d-escape-decision.md) → [6e](stage6e-scan-state-machine.md)。
> **編集はあなた**。括弧は半角。

---

## 0. この回の前提：ファームのサーボ挙動（設計を決める3点）
1. **500msブロッキング＋detach**：N=5を受けるとUNOは `write()`→`delay(500)`→`detach()`。**次のN=21応答前に必ず整定**。[DeviceDriverSet_xxx0.cpp:402-421]
   → **ブレイン側のsettle待ちは作らない**。首を向けた次のreadが既に整定済みの値（UNOは単スレッド＋1ループ1フレーム[ApplicationFunctionSet_xxx0.cpp:1776]で、N=5の500ms後にN=21へ応答）。
2. **10°刻み・[10°,170°]**：D2を `/10`→clamp[1,17]→`×10`。送る角度は**10の倍数・10〜170**。[DeviceDriverSet_xxx0.cpp:392-403]
3. **N=21はサーボを動かさない・N=5以外で首は動かない**＝保持。[ApplicationFunctionSet_xxx0.cpp:1516]

## 0.1 この回の増分

| # | 増分 | 種別 | テスト |
|---|---|---|---|
| 1 | `types`：`Command.aimDeg?` ／ `config`：`scanCenterDeg`（※済んでいれば飛ばす） | 型/config | — |
| 2 | `protocol.encodeServo` | 純 | **先に書く** |
| 3 | `serial-robot.send`：**首→駆動**の順 | 副作用 | Fakeで順序検証 |
| 4 | `sim/model`：`World.servoDeg`＋角度レイキャスト＋`advance`反映 | 純/リファクタ | **先に書く**＋既存緑維持 |
| 5 | `main`：接続時に首を中央化／`initialWorld`に`servoDeg` | 配線 | 手動 |

---

## 1. 型・config（既に入っていれば確認だけ）

`types.ts` の `Command` に（済）：
```ts
/** 指定時、超音波の首(サーボZ)をこの角度[10..170, 10刻み]へ。省略時は動かさない。 */
aimDeg?: number;
```
`types.ts` の `Config` と `config.ts` の `defaultConfig` に（済）：
```ts
// types.ts Config 内
/** スキャン時の首の正面角[度]。10の倍数。 */
scanCenterDeg: number;
// config.ts defaultConfig 内
scanCenterDeg: 90,
```

## 2. 増分2：protocol（`encodeServo`）

### ① RED — `protocol.test.ts`（import に `encodeServo` を足し、describe を追加）
```ts
describe("encodeServo", () => {
    it("encodeServo → N=5 D1=1 D2=angle, H は文字列", () => {
        const o = JSON.parse(encodeServo(150, "5"));
        expect(o).toMatchObject({ H: "5", N: 5, D1: 1, D2: 150 });
        expect(typeof o.H).toBe("string");    // ファームは H を char* で読む
    });
});
```
### ② GREEN — `protocol.ts` に追加
```ts
/** 超音波の首(サーボZ=水平)を angle[度]へ。N=5 D1=1。ファームは D2/10 を10°刻みで使う。 */
export function encodeServo(angle: number, h: string): string {
    return JSON.stringify({ H: h, N: 5, D1: 1, D2: angle });
}
```

## 3. 増分3：serial-robot（首→駆動の順）

### ① RED — `serial-robot.test.ts` に追加
```ts
it("send: aimDeg ありは 首(N=5)→駆動 の順に2回 write", async () => {
    const tx = new FakeTransport({});
    await new SerialRobot(tx).send({ kind: "stop", speed: 0, aimDeg: 150 });
    expect(tx.writes).toHaveLength(2);
    expect(JSON.parse(tx.writes[0])).toMatchObject({ N: 5, D1: 1, D2: 150 });  // 先に首
    expect(JSON.parse(tx.writes[1])).toMatchObject({ N: 4 });                  // 後に停止
});
it("send: aimDeg なしは駆動のみ(サーボを動かさない)", async () => {
    const tx = new FakeTransport({});
    await new SerialRobot(tx).send({ kind: "reverse", speed: 80 });
    expect(tx.writes).toHaveLength(1);
    expect(JSON.parse(tx.writes[0])).toMatchObject({ N: 3, D1: 4, D2: 80 });
});
```
### ② GREEN — `serial-robot.ts`
**import に `encodeServo` を足す：**
```ts
import {
    encodeCommand, encodeQueryDistance, encodeQueryLifted,
    encodeServo,                                   // ← 追加
    parseFrame, decodeDistance, decodeLifted
} from "../protocol/protocol";
```
**`send` を差し替え（Before→After）：**
```ts
// Before
async send(cmd: Command): Promise<void> {
    await this.tx.write(encodeCommand(cmd, cmd.kind === "stop" ? "4" : "3"));
}
// After
async send(cmd: Command): Promise<void> {
    if (cmd.aimDeg !== undefined) await this.tx.write(encodeServo(cmd.aimDeg, "5"));  // 首→
    await this.tx.write(encodeCommand(cmd, cmd.kind === "stop" ? "4" : "3"));         // 駆動
}
```
`read()` は**無変更**（首を向けた状態の正面距離が、向いた方向の距離になる＝ファーム事実3）。

## 4. 増分4：sim（首の向き）— `sim/model.ts` 全文差分

### ① RED — `model.test.ts`
**`world()` ヘルパに `servoDeg`（既定90）を足す（既存テストは不変）：**
```ts
// Before: const world = (x,y,yawDeg) => ({ pose:{x,y,yawDeg} });
const world = (x: number, y: number, yawDeg: number, servoDeg = 90): World =>
    ({ pose: { x, y, yawDeg }, servoDeg });
```
**追加 describe：**
```ts
describe("advance: 首(servoDeg)", () => {
    it("aimDeg は servoDeg を更新し、姿勢は変えない(stop)", () => {
        const w = advance(world(50, 75, 0), { kind: "stop", speed: 0, aimDeg: 150 }, sc);
        expect(w.servoDeg).toBe(150);
        expect(w.pose).toEqual({ x: 50, y: 75, yawDeg: 0 });
    });
    it("aimDeg 省略時は servoDeg を保持(前進しても首は動かない)", () => {
        const w = advance(world(50, 75, 0, 150), { kind: "forward", speed: 255 }, sc);
        expect(w.servoDeg).toBe(150);
    });
});

describe("readSensors: 首の向きで測る", () => {
    const sc50 = { ...sc, roomW: 50, roomH: 50 };
    it("正面(servo90)は前方の壁まで", () => {
        expect(readSensors(world(25, 25, 0), sc50).distanceCm).toBeCloseTo(25);   // 右壁 50-25
    });
    it("左を見る(servo150=正面+60度)→斜め前の壁まで", () => {
        expect(readSensors(world(25, 25, 0, 150), sc50).distanceCm).toBeCloseTo(28.87, 1);
    });
    it("右を見る(servo30=正面-60度)→対称で同じ距離", () => {
        expect(readSensors(world(25, 25, 0, 30), sc50).distanceCm).toBeCloseTo(28.87, 1);
    });
});
```
### ② GREEN — `model.ts`（型・既定・関数の差分）
```ts
/** 仮想世界の状態。姿勢＋首の向き(90=正面)。 */
export type World = { pose: Pose; servoDeg: number };

export type SimConfig = {
    roomW: number; roomH: number; maxDriveCmPerTick: number; maxTurnDegPerTick: number;
    /** 首の正面角[度]。config.scanCenterDeg と一致させる(ハードコード排除)。 */
    servoForwardDeg: number;
};
export const defaultSimConfig: SimConfig = {
    roomW: 200, roomH: 150, maxDriveCmPerTick: 4, maxTurnDegPerTick: 8,
    servoForwardDeg: 90,
};

export function advance(w: World, cmd: Command, sc: SimConfig): World {
    const p = w.pose;
    const servoDeg = cmd.aimDeg ?? w.servoDeg;            // 首は独立に反映(省略時は保持)

    if (cmd.kind === "forward" || cmd.kind === "reverse") {
        const sign = cmd.kind === "forward" ? 1 : -1;
        const d = sign * (cmd.speed / 255) * sc.maxDriveCmPerTick;
        const rad = (p.yawDeg * Math.PI) / 180;
        return { servoDeg, pose: { ...p,
            x: clamp(p.x + Math.cos(rad) * d, 0, sc.roomW),
            y: clamp(p.y + Math.sin(rad) * d, 0, sc.roomH) } };
    }
    if (cmd.kind === "rotateLeft" || cmd.kind === "rotateRight") {
        const a = (cmd.speed / 255) * sc.maxTurnDegPerTick;
        const sign = cmd.kind === "rotateLeft" ? 1 : -1;
        return { servoDeg, pose: { ...p, yawDeg: p.yawDeg + sign * a } };
    }
    return { servoDeg, pose: p };                         // stop: 姿勢そのまま・首だけ反映
}

export function readSensors(w: World, sc: SimConfig): Sensors {
    const aimOffset = w.servoDeg - sc.servoForwardDeg;    // 90→0, 150→+60(左), 30→-60(右)
    return {
        distanceCm: frontDistance(w.pose, aimOffset, sc),
        yawDeg: w.pose.yawDeg,
        lifted: false,
    };
}

// frontDistance に aimOffset を足す(向きを首ぶん回してレイキャスト)
function frontDistance(p: Pose, aimOffset: number, sc: SimConfig): number {
    const rad = ((p.yawDeg + aimOffset) * Math.PI) / 180;   // ★ aimOffset を加味
    const dx = Math.cos(rad), dy = Math.sin(rad);
    let best = Infinity;
    if (dx > 0) best = Math.min(best, (sc.roomW - p.x) / dx);
    if (dx < 0) best = Math.min(best, (0 - p.x) / dx);
    if (dy > 0) best = Math.min(best, (sc.roomH - p.y) / dy);
    if (dy < 0) best = Math.min(best, (0 - p.y) / dy);
    return best;
}
```
### 4.1 World 形状変更の波及（割れる箇所を**全部**直す）

`World` に `servoDeg` を**必須**で足すと、World を組み立てている所が全部 TypeScript エラーになる。**これは安全網**＝漏れなく直せる。`npm run typecheck` が 0 になるまで、次の**4箇所**を直す（`grep -rn "pose:" src` でも洗える）。

**(1) `sim/model.test.ts` の `world()` ヘルパ** — 4つ目の引数を既定値つきで足す（既存の `world(x,y,yaw)` 呼び出しは無変更で通る）：
```ts
// Before
function world(x: number, y: number, yawDeg: number): World { return { pose: { x, y, yawDeg } }; }
// After
function world(x: number, y: number, yawDeg: number, servoDeg = 90): World {
    return { pose: { x, y, yawDeg }, servoDeg };
}
```

**(2) `sim/model.test.ts` の純粋性テストのスナップショット** — ★ここが落とし穴。フィールドを手で並べると `servoDeg` を取りこぼして `toEqual` が落ちる。**丸ごと複製**が“正しい形”（World が増えても割れない）：
```ts
// Before(壊れる: servoDeg を含まない)
const snap = { pose: { ...before.pose } };
// After(全フィールドを複製)
const snap = structuredClone(before);          // or JSON.parse(JSON.stringify(before))
```

**(3) `sim/sim-robot.test.ts` の `world()` ヘルパ** — (1)と同じ直し（こちらはアロー関数）：
```ts
// Before
const world = (x: number, y: number, yawDeg: number): World => ({ pose: { x, y, yawDeg } });
// After
const world = (x: number, y: number, yawDeg: number, servoDeg = 90): World =>
    ({ pose: { x, y, yawDeg }, servoDeg });
```

**(4) `main.ts` の `initialWorld`** — §5の通り `servoDeg: defaultConfig.scanCenterDeg` を足す。

> **DRYメモ**：`world()` が2テストに重複（servoDeg 既定も2箇所）。気になるなら `sim/` に共有ファクトリ `makeWorld(over)` を1つ置いて両テストで使えば、次に World が増えても**1箇所**で済む。ただし本プロジェクトは「テストごとにローカル小ヘルパ」が既定なので、重複1個なら上の最小修正で十分。
> **一般原則（“正しい形”）**：値オブジェクト（World/State/Pose）の「壊さない」テストは**全複製スナップショット**（`structuredClone`）にしておくと、フィールド追加で割れない。フィールドを手で並べた `{ pose: {...} }` は脆い。

## 5. 増分5：main（接続時に首を中央化）

`main.ts`：
```ts
// initialWorld に servoDeg を足す
const initialWorld: World = {
    pose: { x: 20, y: defaultSimConfig.roomH / 2, yawDeg: 0 },
    servoDeg: defaultConfig.scanCenterDeg,            // ← 追加
};

// USB/WiFi 共通の connect ヘルパ内、connect 成功直後に首を正面へ(起動時の不定角対策)
await session.connect(openTransport, (robot) => createRunner(/* ...既存... */));
await session.robot?.send({ kind: "stop", speed: 0, aimDeg: defaultConfig.scanCenterDeg }); // ← 追加
console.log(okMsg);
```

---

## 6. 実行・確認
```bash
cd app
npm run test:run    # protocol(encodeServo) / serial-robot(送信順×2) / model(servo×5) が緑
npm run typecheck   # World 変更の波及(initialWorld・各 world ヘルパ)が消えていること
npm run dev         # 実機接続→首が正面を向く。自走挙動は不変(まだ首は振らない)
```

## 7. 充足と完了条件
| 対象 | テスト |
|---|---|
| encodeServo（N=5 D1=1・H文字列） | protocol.test |
| 送信順（首→駆動／駆動のみ） | serial-robot.test ×2 |
| servoDeg 反映・首の向きレイキャスト | model.test（advance×2・readSensors×3） |
| 既存回帰なし | 既存 model/sim-robot テスト緑 |

- **手動（N3/N6/N7）**：`scanLeftDeg=150` が体の左か（N3・6dで使用時）、500ms中のRXバッファ（N6）、WiFi遅延（N7）。
- 完了：全自動テスト緑＋typecheck緑。**ブレイン挙動は不変**（配線のみ）。

---
関連：[stage6 インデックス](stage6-scan-and-reverse.md)／ [machine-reference.md](../reference/machine-reference.md) §7.1,§9／ 次：[6d 首振りスキャンで空いた方へ](stage6d-escape-decision.md)
