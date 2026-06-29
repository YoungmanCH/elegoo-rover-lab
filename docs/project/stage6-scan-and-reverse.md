# 段階6：減速 ＋ 後退 ＋ 首振りスキャン — 分割インデックス

> **ゴール**：「壁まで直進→固定方向に約90度旋回」だけの頭脳を、**①ゆっくり ②後退できる ③壁で首を振り左右を見て空いた方へ ④左右とも塞がりは少し後退して180度旋回**に拡張する。
> **なぜ分割するか**：4つの機能＋インフラを1枚に書くと大きすぎ、TDDの「1増分＝1テスト群＝1出荷」が崩れる。stage7（[7a〜7d](stage7a-pose-and-kinematics.md)）に倣い、**英字サブステージ 6a〜6e** に割る。各サブステージは**独立に緑（テスト通過）＝独立に出荷可能**。
> **TDDの作法（本シリーズ共通）**：1増分ずつ「**①テストを先に書く(RED)→②最小実装(GREEN)→③リファクタ**」。インフラ（6b/6c）はブレインを変えず完全テスト可能にし、ポリシー（6d/6e）がそれを使う。
> **本書の役割**：個々の実装は各サブステージに置く。ここは**地図・要件対応・横断するファーム事実・横断する手動校正**だけを持つ。
> **前提**：[stage5](stage5-wireless-camera.md) まで。原則は [code-design.md](code-design.md)、現状 [current-build-spec.md](../reference/current-build-spec.md)、目標値 [research-roomba-speed-and-motion.md](../reference/research-roomba-speed-and-motion.md)、サーボ/プロトコル [machine-reference.md](../reference/machine-reference.md) §7.1/§9。

---

## 1. サブステージ地図（依存順）

| 段 | 表題 | 種別 | 触る所 | 独立して緑か |
|---|---|---|---|---|
| **[6a](stage6a-slowdown.md)** | 減速 | config | `config.ts` | ✓（既存テスト緑のまま＋手動） |
| **[6b](stage6b-reverse-command.md)** | 後退コマンド | infra | `types`/`protocol`/`sim` | ✓（protocol/model.test） |
| **[6c](stage6c-servo-aiming.md)** | サーボ首振りの配線 | infra | `types`/`protocol`/`serial-robot`/`sim`/`main` | ✓（protocol/serial-robot/model.test） |
| **[6d](stage6d-escape-decision.md)** | 逃げ方の判断 `chooseEscape`（左/右/後退の3択） | policy(純) | `domain/scan-decision`(新)/`types` | ✓（scan-decision を網羅・Config非依存） |
| **[6e](stage6e-scan-state-machine.md)** | スキャン状態機械（首振り→空いた方へ／行き止まり後退+180） | policy | `cleaning`/`config`/`types`＋結合 | ✓（cleaning/結合） |

依存：6d←6c、6e←6b＋6c＋6d。**6a/6b/6c は順不同で出せる土台**、6d（判断）→6e（挙動）がコア。
**判断と挙動を分離**：両側塞がり→後退は **6d の `chooseEscape` が3択（左/右/reverse）で決定に明記**し、6e の状態機械がそれを実行する（要件④を型で守る）。

## 2. 要件 → サブステージ対応

| 要件 | 担当 |
|---|---|
| ① 移動・旋回が速すぎる→ゆっくり | 6a |
| ② バックできるように | 6b（コマンド）＋ 6e（脱出で実行） |
| ③ 壁で首を振り空いた方へ（固定方向旋回をやめる） | 6c（配線）＋ 6d（判断）＋ 6e（実行） |
| ④ 左右とも塞がり→少し後退して180度 | 6d（判断: `reverse`）＋ 6e（実行） |

---

## 3. 横断するファーム事実（実機ソースで裏取り済み・全サブステージ共通）

> 出典は `arduino/SmartRobotCarV4.0_DIY/`。**この5つがスキャン/後退設計の前提**。`[file:line]` 付き。

1. **パーサは1ループ1フレーム**：`SerialPortDataAnalysis` は `}` まで読んで1フレームだけ処理する → **N=5(サーボ)→N=3/N=4(駆動) を2フレーム送ると別ループで順次実行**される。[ApplicationFunctionSet_xxx0.cpp:1776]
2. **サーボ駆動は500msブロッキング＋detach**：`Servo_controls` は `write()` 後に `delay(500)` してから `detach()`。**UNOは次のN=21に応答する前に必ず500ms整定する** → **首を向けた直後の1回のreadが既に整定済みの値**＝**ブレイン側のsettle待ちは不要**。[DeviceDriverSet_xxx0.cpp:402-421]
3. **サーボ角は10°刻み・[10°,170°]にクランプ**：N=5 D2を `/10`→clamp[1,17]→`×10`。`scanLeftDeg=150/center=90/scanRightDeg=30` は全て妥当（多くの10の倍数）。[DeviceDriverSet_xxx0.cpp:392-403]
4. **N=21はサーボを動かさない**：距離取得は ping のみ＝**首を向けた方向の距離が取れる**（スキャンが原理的に成立）。idle/standbyでサーボを戻す処理も無い＝**N=5以外でサーボは動かない＝保持される**。[ApplicationFunctionSet_xxx0.cpp:1516]
5. **後退(N=3 D1=4)は前進と同じジャイロ直進補正を通る**：`Backward → LinearMotionControl`。**後退の直進性は前進と同程度**（ジャイロが死んでいれば両方open-loop）。低速D2は上限180クランプのみ＝**減速はそのまま効く**。[ApplicationFunctionSet_xxx0.cpp:256-265, 230-232]

ウォッチドッグ2s（[machine-reference §8]）に対し servo の500msは1ループ1回で余裕あり。

---

## 4. 横断する手動校正チェックリスト（純ロジックでは担保不可。各段の実機確認で潰す）

[code-design §7](code-design.md)「純粋=Vitest／物理=手動」に従う。**ここを明示しないと“テスト済み”が嘘になる**。

| ID | 内容 | 主担当 |
|---|---|---|
| N1 | 低PWMでモータが**停動**しない下限（driveSpeed/turnSpeed/reverseSpeed） | 6a/6b/6e |
| N2 | `turnTicks`≒90度・`turnTicks180`≒180度の実角（床/電圧/個体差） | 6a/6e |
| N3 | `scanLeftDeg=150` が**体の左**を向く（不変条件。逆なら150↔30入替） | 6c/6e |
| N4 | 後退がまっすぐ下がるか（前進と同経路なので低リスク・要観察） | 6b/6e |
| N5 | 超音波の**斜め反射**で左右が誤測（0/近接の誤り）→ `openCm` 調整 | 6e |
| N6 | 500msブロック中の **RXバッファ(64B)** 取りこぼし（N=4/N=21が溜まる） | 6c/6e |
| N7 | WiFi経由でスキャン(首振り)の体感遅延（1壁あたり約1.5s停止） | 6e |

各段の完了条件 ＝ **その段の全自動テスト緑 ＋ 関係する N を消化**。

---

## 5. テスト十分性の方針
- **純粋ロジック**（scan-decision/cleaning/protocol/sim-model）＝Vitestで**遷移表・判断分岐・境界を網羅**（各段に充足表）。
- **副作用**（serial-robot 送信順）＝FakeTransportで検証。
- **物理**（整定・実角度・停動・反射）＝§4の手動チェック。自動化できないと正直に書く。

---
関連：[code-design.md](code-design.md)／ [cleaning-logic-spec.md](cleaning-logic-spec.md)／ [stage4-timed-turn.md](stage4-timed-turn.md)／ [current-build-spec.md](../reference/current-build-spec.md)／ [machine-reference.md](../reference/machine-reference.md)
次：[6a 減速](stage6a-slowdown.md) から着手。
