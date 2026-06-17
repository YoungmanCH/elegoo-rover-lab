# 仕様：掃除ロジック（単純版）

> **なぜ**：自走掃除の中核を「前進(ジャイロ直進) → 壁検知 → Yaw角度で旋回 → 前進」の最小形で固めるため。
> **なんのために**：これをそのまま TS に落として、単体テスト＆シムで先に検証し、同じ関数を実機(JSON)で動かす。
> **だれのために**：実装する自分。ロジックの一次仕様。
>
> 前提（[research-route-and-avoidance.md](../reference/research-route-and-avoidance.md)）：直進はファーム側がジャイロYawで補正済み。旋回は時間ベースで不正確なので、**Yaw角度で閉ループ旋回**するのが本仕様の肝。位置情報は無い＝「経路」は動きの決まりとして持つ。

## 1. 振る舞い（状態機械：2状態だけ）

```
 ┌─ DRIVE(前進) ─┐   距離 < wallCm    ┌─ TURN(左旋回) ─┐
 │ 前進し続ける    │ ───────────────▶ │ 目標角まで回る   │
 └────────────────┘ ◀─────────────── └─────────────────┘
                     |Δyaw| ≥ targetDeg で復帰
   ※ lifted(離地) を検知したら、どちらの状態でも STOP。
```

- **DRIVE**：前進指令を出し続ける（直進補正はファーム任せ）。毎tick 前方距離を見て、`距離 < wallCm` で TURN へ（`startYaw=現在yaw`、`目標角=turnDeg`〔左〕を記録）。
- **TURN**：その場左旋回。毎tick yaw を見て、`|yaw − startYaw| ≥ 目標角` で DRIVE へ戻る。
- 左回りベース。局所ループ回避に目標角へ小さな乱数(±jitter)を混ぜてもよい（任意）。

> **補足（旋回は目標角を少しオーバーする）**：旋回は制御周期ごとに一定角度ずつ進む**離散制御**。`|Δyaw| ≥ targetDeg` をまたいだ**次のtickで止まる**ので、必ず1tickぶん行き過ぎる。例：シムで約4.7度/tick のとき **19tick=89.4度（<90で継続）/ 20tick=94.1度（≥90で停止）→ 約4度オーバー**。実用上は問題なし。直角に寄せたいなら1tickの回転角を小さく（`turnSpeed`↓）。実機でも同種の量子化誤差は出る。

## 2. 入出力（純関数）

```ts
type Sensors = { distanceCm: number; yawDeg: number; lifted: boolean };
type Command = { kind: "forward" | "rotateLeft" | "stop"; speed: number };
type State   = { phase: "drive" | "turn"; startYaw: number; targetDeg: number };

function step(s: Sensors, st: State, cfg: Config): { cmd: Command; next: State } {
  if (s.lifted) return { cmd: { kind: "stop", speed: 0 }, next: st };

  if (st.phase === "drive") {
    if (s.distanceCm < cfg.wallCm)
      return { cmd:  { kind: "rotateLeft", speed: cfg.turnSpeed },
               next: { phase: "turn", startYaw: s.yawDeg, targetDeg: cfg.turnDeg /* +jitter */ } };
    return { cmd: { kind: "forward", speed: cfg.driveSpeed }, next: st };
  }
  // turn
  if (Math.abs(s.yawDeg - st.startYaw) >= st.targetDeg)
    return { cmd: { kind: "forward", speed: cfg.driveSpeed }, next: { ...st, phase: "drive" } };
  return { cmd: { kind: "rotateLeft", speed: cfg.turnSpeed }, next: st };
}
```

ポイント：副作用ゼロ・センサ入力のみで決まる＝**この関数だけで単体テストもシムもできる**。yaw がどこから来るか（実機/シム）は関知しない。

## 3. 実機へのマッピング（JSON）[code-reference §A-2]

| cmd / 入力 | JSON | 備考 |
|---|---|---|
| forward | `{"H":1,"N":3,"D1":3,"D2":speed}` | 直進はファームのジャイロ補正経由 |
| rotateLeft | `{"H":1,"N":3,"D1":1,"D2":speed}` | その場左旋回 |
| stop | `{"H":1,"N":3,"D1":3,"D2":0}` | |
| distanceCm | `{"N":21,"D1":2}` → `{H_<cm>}` | |
| lifted | `{"N":23}` → `{H_true/false}` | **真偽が反転**（接地→`_true` / 離地→`_false`）⇒ `lifted=(payload==="false")` |
| yawDeg | **JSONに無い** | → `N=24` 自前追加が必要（§6） |

## 4. パラメータ（初期値）

| 名前 | 初期 | 意味 |
|---|---|---|
| `wallCm` | 20 | 壁検知しきい値 |
| `turnDeg` | 90 | 1回の旋回角 |
| `jitter` | 0〜±15 | 旋回角の散らし（任意） |
| `driveSpeed` | ~120 | 前進速度(0-255) |
| `turnSpeed` | ~150 | 旋回速度(0-255) |
| `tick` | ~120ms | 制御周期 |

## 5. 検証（シム/単体が先、実機は後）

- **単体テスト**：step() の分岐を網羅 — `距離>閾値→forward` ／ `距離<閾値→turn開始(rotateLeft)` ／ `旋回中(角度未達)→継続` ／ `角度到達→drive復帰(forward)` ／ `lifted→stop`。
- **シム（結合）**：2D俯瞰（ロボット姿勢＋矩形の壁）。`distanceCm`=heading方向のレイキャスト、`yawDeg`=heading。step() の指令でロボットを動かし「**壁を貫通しない／無限停止しない／壁際で曲がる**」を確認。
- **注意**：理想シムは**ロジックの破綻検出**用。**カバー率（何%拭けるか）は予測できない**（エンコーダ無し・スリップ・超音波ノイズ）。

## 6. 既知の依存（正直に）

- `yawDeg` は純正JSONに取得コマンドが無い → 実機で角度旋回するには **`N=24`（Yaw返却）を1個足す**必要（[machine-reference §12](../reference/machine-reference.md) / research §3）。**シム・単体テストは yaw を入力で受けるだけなので、この依存の影響を受けない**（実機接続を待たず開発できる）。
- 旋回角は「相対角」で使う（Yawは積分ドリフトするが、短時間の差分なら実用上OK）。

---
関連：[plan-diy-roomba-impl.md](plan-diy-roomba-impl.md) ／ [research-route-and-avoidance.md](../reference/research-route-and-avoidance.md) ／ [code-reference-classes.md](../reference/code-reference-classes.md)
