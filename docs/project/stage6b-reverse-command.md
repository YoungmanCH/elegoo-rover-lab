# 段階6b：後退コマンド — `reverse` を足す（土台・infra）

> **ゴール**：頭脳の語彙に **`reverse`（後退）** を1種足す。プロトコル変換とシム物理まで通すが、**ブレインはまだ使わない**（6eで使用）。要件②の土台。
> **TDDの作法**：infra なので**完全にテスト可能**。「①テスト(RED)→②実装(GREEN)」を `protocol` と `sim/model` で回す。`cleaning.ts` は**無変更**（後退を出さない）。
> **前提**：[6a](stage6a-slowdown.md) まで。**ファーム裏取り**（[インデックス §3.5](stage6-scan-and-reverse.md)）：`N=3 D1=4` ＝後退で、**前進と同じジャイロ直進補正**を通る（[ApplicationFunctionSet_xxx0.cpp:256-265]）。
> **このstageの位置**：[6a](stage6a-slowdown.md) → **6b(本書)** → [6c](stage6c-servo-aiming.md) → [6d](stage6d-escape-decision.md) → [6e](stage6e-scan-state-machine.md)。
> **編集はあなた**。括弧は半角。

---

## 0. この回の増分

| # | 増分 | 種別 | テスト |
|---|---|---|---|
| 1 | `Command.kind` に `"reverse"` | 型 | — |
| 2 | `protocol`：`reverse → N=3 D1=4` | 純 | **先に書く** |
| 3 | `sim/model`：`advance` が後退を動かす | 純 | **先に書く** |

---

## 1. 増分1：型（`types.ts`）

**Before:**
```ts
kind: "forward" | "rotateLeft" | "rotateRight" | "stop";
```
**After:**
```ts
/** forward=直進 / reverse=後退 / rotateLeft|Right=その場旋回 / stop=停止 */
kind: "forward" | "reverse" | "rotateLeft" | "rotateRight" | "stop";
```

## 2. 増分2：protocol（`reverse → N=3 D1=4`）

### ① テストを先に書く（RED）— `protocol.test.ts` 追加
```ts
it("reverse → N=3 D1=4", () => {
    expect(JSON.parse(encodeCommand({ kind: "reverse", speed: 80 }, "1")))
        .toMatchObject({ N: 3, D1: 4, D2: 80 });
});
```
### ② 実装（GREEN）— `protocol.ts`
```ts
// N=3 の D1: 1=左 / 2=右 / 3=前進 / 4=後退
const DRIVE_DIR = { forward: 3, reverse: 4, rotateLeft: 1, rotateRight: 2 } as const;
```
`encodeCommand` 本体は無変更（`DRIVE_DIR[cmd.kind]` がそのまま 4 を引く）。`serial-robot` も無変更（`reverse` の H は "3" 系で送られる）。

## 3. 増分3：sim 物理（後退）

### ① テストを先に書く（RED）— `model.test.ts` 追加
```ts
const rev = (speed: number): Command => ({ kind: "reverse", speed });

it("reverse(yaw=0) → -x 方向へ進む(speed=255)", () => {
    const w = advance(world(50, 75, 0), rev(255), sc);
    expect(w.pose.x).toBeCloseTo(46);          // 50 - 4
});
it("reverse は speed に比例", () => {
    const w = advance(world(50, 75, 0), rev(128), sc);
    expect(w.pose.x).toBeCloseTo(50 - (128 / 255) * 4);
});
it("reverse は壁を越えない(左端でクランプ)", () => {
    const w = advance(world(1, 75, 0), rev(255), sc);
    expect(w.pose.x).toBe(0);                  // 0 でクランプ
});
```
### ② 実装（GREEN）— `model.ts` の `advance`
前進と後退を**符号だけ違いで合流**（重複排除）：
```ts
if (cmd.kind === "forward" || cmd.kind === "reverse") {
    const sign = cmd.kind === "reverse" ? -1 : 1;        // 後退は逆向き
    const d = sign * (cmd.speed / 255) * sc.maxDriveCmPerTick;
    const rad = (p.yawDeg * Math.PI) / 180;
    return { ...w, pose: { ...p,
        x: clamp(p.x + Math.cos(rad) * d, 0, sc.roomW),
        y: clamp(p.y + Math.sin(rad) * d, 0, sc.roomH) } };
}
```

---

## 4. 充足と完了条件
- **自動**：protocol.test（reverse変換）＋ model.test（後退3ケース）緑。`cleaning` は無変更なので既存緑のまま。
- **手動（N4）**：実機投入は6eで後退を使うときに。後退は前進と同経路なので**直進性は前進と同程度**（要観察）。
- 完了：上記テスト緑＋ typecheck 緑。**ブレインの挙動は変わらない**（後退は語彙が増えただけ）。

---
関連：[stage6 インデックス](stage6-scan-and-reverse.md)／ 次：[6c サーボ首振りの配線](stage6c-servo-aiming.md)
