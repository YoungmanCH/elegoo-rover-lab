# 規約：MEASURED / COMMANDED / ESTIMATED の明示（推定を実測に見せない）

> **ゴール**：「実測」「指令」「推定」を**型・画面・ログ**で明示的に区別する共通規約。**推定を消さなくても、実測に見せない**ようにする（消す道＝[stage14 B2](stage14-honest-measured-log.md) は本規約に従う1手段）。
> **なぜ**：エンコーダ無し＝`pose(x,y,yaw)` は指令からの dead-reckoning でドリフト（＝推定）。だが「消す」以外に「**明示ラベルで正直に残す**」道もある。本規約は**どちらを選んでも「取り違え」を構造的に防ぐ**土台。
> **適用**：[stage13](stage13-measured-only-sensor-view.md)（表示）／[stage14](stage14-honest-measured-log.md)（記録）／以降すべて。
> **検証**：`Estimated<T>` ブランド（tsc が実測スロットへの混入を弾くのを `@ts-expect-error` で実証）・`formatEstimateLine`（注記強制）を**実測確認済み**。

---

## 1. 3カテゴリの定義
| 種別 | 意味 | 例 |
|---|---|---|
| **MEASURED（実測）** | センサーが返した値 | `distanceCm`(超音波)・`lifted`・`dt`/時刻 |
| **COMMANDED（指令）** | こちらが送った事実（no feedback だが「送った」は事実） | `cmd.kind`/`speed`・首の servo 角 |
| **ESTIMATED（推定）** | 指令から derived・**ドリフトする** | `pose(x,y,yaw)`・現状の `yaw`・移動/回転の積算 |

> **原則**：**ESTIMATED を MEASURED として見せない/使わない**。COMMANDED は「指令」と分かる形で。

## 2. 境界表（各データの分類＝正本）
| データ | 種別 | 根拠 |
|---|---|---|
| `distanceCm` | MEASURED | 超音波 N=21 |
| `lifted` | MEASURED | N=23 |
| `t` / `dt` | MEASURED | 実時間 |
| `cmd.kind` / `speed` | COMMANDED | 送った指令 |
| 首 servo 角（AIM） | COMMANDED | 指令（servo feedback 無し） |
| `phase` | COMMANDED相当 | 内部状態（事実） |
| **`pose.x` / `pose.y`** | **ESTIMATED** | 位置センサー皆無＝**原理的に実測不可** |
| **`pose.yawDeg`** | **ESTIMATED**（当面） | 指令積分。※IMU を firmware が返せば MEASURED に格上げ可 |

## 3. コード規約：`Estimated<T>` opaque ブランド（検証済み）
推定値は **opaque ブランドで封じ、実測スロットに素で入れられない**ようにする。中身を使うには明示 unwrap を強制＝「これは推定」と毎回認める。

```ts
// domain/estimated.ts（実装済み・実行時＋型を検証済み）
const EST: unique symbol = Symbol("estimated");     // ★実 symbol（declare だと実行時に ReferenceError で落ちる）
/** 推定値(指令からの dead-reckoning・ドリフト)。実測と混ぜないための opaque マーカー。 */
export type Estimated<T> = { readonly [EST]: T };
export function estimated<T>(v: T): Estimated<T> { return { [EST]: v } as Estimated<T>; }
/** 推定と承知で取り出す(呼ぶこと自体が「これは推定」の明示)。 */
export function takeEstimate<T>(e: Estimated<T>): T { return e[EST]; }
```
> **直列化の注意**：opaque は `{[EST]:v}` の実体を持つ＝`JSON.stringify` は symbol キーを落とす。**ログに出す前に必ず `takeEstimate` で開く**（`serialize` は pose を `est_x/est_y/est_yaw` に平坦化して出す）。
**型が取り違えを弾くことの実証**（`@ts-expect-error` が成立＝tsc 緑）：
```ts
const e: Estimated<Pose> = estimated({ x: 1, y: 2 });
// @ts-expect-error 推定は実測(Pose)スロットにそのまま入れられない
const bad: Pose = e;
const ok: Pose = takeEstimate(e);   // 明示 unwrap すればOK
```
- **命名**：MEASURED は素の型・素の名（`distanceCm`）。ESTIMATED は `Estimated<T>` ＋ `estimated*` 名。
- `Sensors`（`distanceCm`/`lifted`）は実測なので**素のまま**。`EstimatorPoseSource.next()` は `Estimated<Pose>` を返す（sim の真値 `SimPoseSource` は sim 内では真値＝素でよい）。

## 4. 画面規約（sonar）
- **MEASURED はそのまま描く**（ray・`DIST`）。**COMMANDED はラベル付き**（`CMD`・`AIM`）。
- ❌ **推定“位置ドット/地図”を robot 中心ビューに置かない**——ラベルを付けても**目が絵に引っ張られる**（1分で1m ズレを「そこに居る」と誤認）。
- 推定を画面に出すなら**この1行フォーマットだけ**（検証済み・「※実測ではない」を強制）：
```ts
// ui/readout.ts
export function formatEstimateLine(moveCm: number, turnDeg: number): string {
    const m = Math.round(moveCm), d = Math.round(turnDeg);
    return `推定(参考): 移動~${m}cm 回転~${d >= 0 ? "+" : ""}${d}°  ※指令からの概算・実測ではない`;
}
// 例: "推定(参考): 移動~120cm 回転~+90°  ※指令からの概算・実測ではない"
```
> 位置という**空間的な嘘**を作らず、注記付きの数値だけ。現状の sonar readout は MEASURED＋COMMANDED のみで、推定行は「出すなら必ずこの書式」という規約。

## 5. ログ規約
- **実測列はそのまま**：`t,dt,cmdKind,speed,distanceCm,lifted,phase`。
- **推定を残すなら**：ヘッダ/行の `estimated:true`（既存）＋**列名を `est_` 接頭**（`est_x,est_y,est_yaw`）で字面から「実測でない」を明示。
- ＝これで**「消さずにラベルで残す」が成立**（[stage14 B2](stage14-honest-measured-log.md)＝剥がす／本規約でラベル＝残す、のどちらでも OK）。

## 6. 検証（実測済み）
- `Estimated<T>`：`@ts-expect-error` が成立＝**推定を実測スロットへ代入すると tsc エラー**（＝取り違え不能）。`takeEstimate` で明示 unwrap のみ通る。**tsc 全体クリーン**。
- `formatEstimateLine`：**vitest 2/2**（移動/回転の概算＋注記・符号）。

## 7. 現状への当てはめ（残す場合の移行）
- `TickSample.pose` を残すなら `Estimated<Pose>`（or 列名 `est_*`）＋ `estimated:true`。
- `EstimatorPoseSource.next(): Estimated<Pose>`。`SimPoseSource` は sim 真値＝素。
- 将来 **IMU yaw が実測化**されたら、その `yaw` だけ MEASURED に格上げ（§2 の分類を更新）。

## 8. これで保証されること
- **型**：推定を実測として使えない（tsc が弾く）。
- **画面**：推定“位置”の誤解が構造的に出ない（robot 中心＋出すなら注記1行）。
- **ログ**：列名/フラグで実測 vs 推定が字面で自明。
- ＝**消しても・残しても、「嘘を実測に見せない」が守られる**。

---
関連：[stage13](stage13-measured-only-sensor-view.md)（表示は実測のみ・嘘を描かない）／ [stage14 B2](stage14-honest-measured-log.md)（記録から推定を剥がす＝本規約の“消す”実装）／ [machine-reference §9](../reference/machine-reference.md)（IMU yaw を実測化する余地）
</content>
