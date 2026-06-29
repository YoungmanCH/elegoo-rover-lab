# 段階6a：減速 — 移動・旋回をゆっくりに

> **ゴール**：速すぎる移動・旋回を**ゆっくり**にする。`config.ts` の値だけを変える最小・最安全の増分（要件①）。
> **TDDの作法**：本段は**新ロジック無し＝新テスト無し**。純粋テストは `config(over)` で値を明示するので `defaultConfig` を変えても**緑のまま**。判定は「`npm run test:run` 緑＋実機の体感」。
> **前提**：[stage5](stage5-wireless-camera.md) まで。**ファーム裏取り**（[インデックス §3.5](stage6-scan-and-reverse.md)）：N=3の速度D2は**上限180クランプのみ・下限なし**＝下げればそのまま遅くなる。
> **このstageの位置**：**6a(本書)** → [6b 後退](stage6b-reverse-command.md) → [6c サーボ配線](stage6c-servo-aiming.md) → [6d 空いた方へ](stage6d-escape-decision.md) → [6e 行き止まり](stage6e-scan-state-machine.md)。
> **編集はあなた**。括弧は半角。

---

## 0. この回の増分

| # | 増分 | 種別 | テスト |
|---|---|---|---|
| 1 | `driveSpeed`/`turnSpeed` を下げる | config | 新規なし（既存緑＋手動） |
| 2 | `turnTicks` を再校正（旋回速度低下の相殺） | config | 同上 |

---

## 1. 増分1：速度を下げる（`config.ts`）

**Before:**
```ts
driveSpeed: 120,
turnSpeed: 150,
turnTicks: 4,
```
**After:**
```ts
driveSpeed: 80,     // 120→80。ゆっくり(壁検知の余裕↑)。停動しない下限は実機で探る(N1)
turnSpeed: 100,     // 150→100
turnTicks: 6,       // ★旋回速度を下げた分、約90度に再校正(増分2)
```

> **なぜ遅くするのが正解か**：本物ルンバも巡航20〜30cm/sとわざと遅い。速いと次のセンサ周期前に壁へ突っ込む（[research-roomba-speed-and-motion](../reference/research-roomba-speed-and-motion.md)）。

## 2. 増分2：`turnTicks` の再校正（カップリング）

旋回は「1tickの回転角 × tick数」。**`turnSpeed` を下げると1tickの回転角が減る** → 同じ `turnTicks=4` だと90度に届かない。だから **`turnTicks` を増やして相殺**する。

- 出発値 `turnTicks: 6`。実機で **約90度**になるよう増減（回り過ぎ→減、不足→増）。
- `turnSpeed` を下げるほど1tickが小さく**微調整しやすい**（[cleaning-logic-spec §1 補足](cleaning-logic-spec.md) と同じ理屈）。

> **重要**：`driveSpeed`/`turnSpeed`/`turnTicks` は**連動**する。速度を触ったら旋回角を必ず再確認。

---

## 3. テスト（自動）と手動確認

- **自動**：`npm run test:run` が**緑のまま**であること（`cleaning.test`/`model.test` は `config(over)` で値を明示するので `defaultConfig` 変更の影響を受けない＝**回帰防止の確認だけ**）。
- **手動（N1/N2）**：満充電で実機。
  1. `driveSpeed` を 80 から下げ、**動き出さなくなる直前**（停動下限）を把握。一般にギヤモータは負荷下で60-80未満で停動しやすい。
  2. 壁で旋回させ、**約90度**になる `turnTicks` を確定。
  3. 電圧低下で速度・旋回角は落ちるので**満充電で校正**。

---

## 4. 完了条件
- 全自動テスト緑（回帰なし）。
- 実機で「明らかにゆっくり」かつ「約90度旋回」。停動しない。

---
関連：[stage6 インデックス](stage6-scan-and-reverse.md)／ [research-roomba-speed-and-motion.md](../reference/research-roomba-speed-and-motion.md)／ 次：[6b 後退コマンド](stage6b-reverse-command.md)
