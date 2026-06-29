# 調査：実機ルンバの速度・旋回・後退 — 自走パラメータの目標値

> **なぜこの文書があるか**：自作ルンバの巡航速度・旋回速度・後退の使い方を「なんとなく」で決めないため。**本物のルンバが実際にどう動くか**を公式仕様で裏取りし、我々の `driveSpeed`/`turnSpeed`/`tick` や挙動設計の**目標値**にする。
> **なんのために**：[cleaning-logic-spec.md](../project/cleaning-logic-spec.md) のパラメータと挙動（特に「詰まり脱出」「その場旋回」）を、本物の挙動に寄せて校正する。
> **だれのために**：実装する自分。「速度どれくらい？バックできる？」を後で迷わないため。
> 参照：[vision-autonomy-and-cleaning-roadmap.md](vision-autonomy-and-cleaning-roadmap.md) §3.1 ／ [machine-reference.md](machine-reference.md) §5,§9 ／ [cleaning-logic-spec.md](../project/cleaning-logic-spec.md)

出典は **iRobot 公式の Open Interface 仕様**（Roomba と同一駆動系の Create 2 で数値が公開されている）。タグは[出典一覧](#出典一覧)。

---

## 1. 結論（数値だけ先に）

| 項目 | 実機ルンバ | 我々への含意 |
|---|---|---|
| **最高直進速度** | **500 mm/s（= 0.5 m/s = 50 cm/s）** | 最高速。巡航はもっと遅い。 |
| **掃除中の巡航速度** | **おおむね 200〜300 mm/s（20〜30 cm/s）** | `driveSpeed` の狙いはここ。速すぎは禁物。 |
| **後退（バック）** | **できる。速度を負値にするだけ**（左右輪 `-500〜500 mm/s`） | ただし“移動モード”ではなく**脱出専用**（後述）。 |
| **旋回** | 速度＋回転半径(`-2000〜2000 mm`)で指定。**半径0＝その場旋回** | その場旋回＝左右逆回転。我々の `rotateLeft` と同じ。 |
| **旋回の角速度** | 理論上限 ≈ **240°/s**、実走行は**60〜120°/s 程度のゆっくり** | タイマー旋回の量子化誤差を抑えるため遅めが正解。 |

> 角速度の理論値：車輪間隔 ≈ 235mm で左右 ±500mm/s 逆回転 → `ω = 1000/235 ≈ 4.26 rad/s ≈ 244°/s`。本物はこれを使い切らずゆっくり回る。

---

## 2. 速度 — 巡航は「わざと遅い」

- 仕様上の上限は **500 mm/s** だが、掃除中はこれを出さない。**通常巡航は 20〜30 cm/s**、壁際・障害物近くではさらに減速する。
- 遅い理由は**センサ判断の余裕を作るため**。前進が速いと、次のセンサ周期が来る前に壁へ突っ込む。
- **我々への適用**：現行 `driveSpeed ~120`（PWM 0-255, [cleaning-logic-spec §4](../project/cleaning-logic-spec.md)）が実際に何 cm/s かはエンコーダ無しで不明。だが**狙う目標は 20〜30 cm/s 巡航**。実機で巻尺＋ストップウォッチで実測し、PWM値を校正するのが正攻法。
- これは現行の `tick ~120ms` 設計と直結：**遅い巡航 × 短い判断周期**で、壁検知から旋回までの余裕を確保する。

## 3. 後退（バック）— できる。ただし“脱出専用”

- **物理的に可能**。実機ルンバは車輪速度を負値にすれば後退する。
- ただし本物は**後退で部屋を走り回らない**。後退を使うのは **「バンプ/壁/詰まり → 短く後退 → その場旋回 → 再前進」** の脱出シーケンスだけ。
- これは roadmap §3.1 の **「詰まり脱出（後退＋大きく旋回）」とそのまま一致**。設計方針は本物に忠実。
- **我々のハードで後退できるか → できる**：TB6612 は逆転対応（[machine-reference §5](machine-reference.md)）。JSON では `N=1`（D3=方向）や `N=4`（左右個別速度）で後退・その場旋回を出せる（[machine-reference §9](machine-reference.md)）。
- **唯一の不足**：現行の純関数 `Command` は `forward / rotateLeft / stop` の3種だけで**後退コマンドが無い**（[cleaning-logic-spec §2](../project/cleaning-logic-spec.md)）。詰まり脱出を実装するなら **`reverse` を1種追加**する必要がある（純関数側の小改修。実機マッピングは `N=3 D1=4` 等）。

## 4. 旋回 — その場回転・ゆっくり

- ルンバの旋回は「速度＋回転半径」。**半径ゼロ＝左右逆回転＝その場旋回**で、我々の `rotateLeft`（`N=3 D1=1`）と同型。
- 角速度は理論上限 ≈ 240°/s だが、実走行は**60〜120°/s のゆっくり**。
- 遅く回す利点は、我々のタイマー旋回（[stage4-timed-turn.md](../project/stage4-timed-turn.md)）の**量子化誤差を小さくできる**こと。cleaning-logic-spec の補足「直角に寄せたいなら `turnSpeed`↓」と同じ理屈で、本物も同じ判断をしている。

---

## 5. 我々の挙動への落とし込み（まとめ）

本物の典型サイクルは:

```
前進巡航(20〜30cm/s) → バンプ/壁/詰まり → 短く後退 → その場旋回 → 再前進
```

- **巡航は遅め**（20〜30cm/s狙い）。`driveSpeed` を実測校正する。
- **後退は脱出専用**。常用しない。→ `Command` に `reverse` を1種足すだけで本物の脱出挙動に届く。
- **旋回はゆっくり**。タイマー旋回の精度のため `turnSpeed` は上げ過ぎない。

→ 現行設計（遅め巡航＋詰まり脱出＋その場旋回）は本物の挙動と整合済み。**実装上の差分は「後退コマンドの追加」1点**。

---

## 6. 未確認（実機で潰す）

- `driveSpeed ~120` / `turnSpeed ~150`（PWM）が実際に何 cm/s・何 °/s か（実測して20〜30cm/sへ校正）。
- ELEGOO 実機のバッテリ電圧低下で速度がどれだけ落ちるか（PWM一定でも電圧降下で減速する）。
- 後退 `reverse` を `N=3 D1=4` で出したときの実挙動（直進補正が後退に効くか）。

---

## 出典一覧

| タグ | 内容 |
|---|---|
| [OI] | iRobot® Create® 2 Open Interface (OI) Specification — 速度 `-500〜500 mm/s`、回転半径 `-2000〜2000 mm`、Drive/Drive Direct コマンド。<https://cdn-shop.adafruit.com/datasheets/create_2_Open_Interface_Spec.pdf> |
| [WIKI] | Roomba — Wikipedia（top speed ≈ 1.1 mph ≈ 0.49 m/s）。<https://en.wikipedia.org/wiki/Roomba> |
| [RKT] | roomba: iRobot Roomba/Create Interface（Racket docs。速度・車輪個別制御の範囲）。<https://docs.racket-lang.org/roomba/index.html> |

> **注記**：Roomba 製品そのものの巡航速度・角速度の「公称値」は公開されていない。本書の「20〜30cm/s」「60〜120°/s」は、公式上限（[OI]）と実機レビュー・一般的観測からの**実用的な目安**であり、厳密な公称ではない。最高速 50cm/s・後退可・回転半径制御は[OI]で確定。

---
関連：[cleaning-logic-spec.md](../project/cleaning-logic-spec.md) ／ [vision-autonomy-and-cleaning-roadmap.md](vision-autonomy-and-cleaning-roadmap.md) ／ [machine-reference.md](machine-reference.md)
