# 現状仕様：いまの自作ルンバは何ができるか（as-built）

> **なぜこの文書があるか**：「今のロボットは実際どう動くのか（速度・掃除の仕方・センサ・カメラ・電池・通信）」を、実装コードから裏取りした**スナップショット**として1枚にまとめるため。仕様を思い出す/人に見せる/次の一手を決める土台。
> **この文書の立ち位置**：
> - **キットの素性**（ピン・チップ・プロトコル）＝ [machine-reference.md](machine-reference.md)
> - **本物ルンバの目標値**＝ [research-roomba-speed-and-motion.md](research-roomba-speed-and-motion.md)
> - **未来の構想**＝ [vision-autonomy-and-cleaning-roadmap.md](vision-autonomy-and-cleaning-roadmap.md)
> - **★この文書＝今こう実装されている（as-built）**。憶測は書かず、実コードを出典にする。
> 出典は `app/src/…` の実ファイル行と段階md。

---

## 0. 一言でいうと

**「壁まで直進 → だいたい90度その場旋回 → また直進」を繰り返すだけ**の、地図を持たないランダム反射型。頭脳はブラウザ(TypeScript)、UNOは手足、ESP32はカメラ＋無線ゲートウェイ。USB でも WiFi でも同じ頭脳で自走する。掃除の“実体”（拭く/吸う）はまだ無く、**走り回るところまで**が現状。

---

## 1. 全体像（3階建て）

```
[ブラウザ app (TypeScript)]  ← 頭脳：掃除の判断・制御ループ・画面
   │  USB(Web Serial)  または  WiFi(WS中継→TCP:100)
   ▼
[ESP32-WROVER-CAM]           ← ゲートウェイ：無線・カメラ(MJPEG)。純正firmware無改造
   │  Serial2 9600bps
   ▼
[Arduino UNO R3]             ← 手足：JSONコマンドでモータ/サーボ/センサを駆動
   │
 モータ×4 / 超音波(サーボ上) / ライン×3 / IMU / RGB / 電圧
```

- **判断は全部ブラウザ側**（`app/src/domain/cleaning.ts`）。UNOには判断を持たせない（手足原則）。[code-design]
- **同じ頭脳でシムも実機も動く**：`RobotIO` 差し替えだけ（`SimRobot`/`SerialRobot`）。

---

## 2. 走行性能・速度

### 今の設定値（`app/src/config.ts`）
| つまみ | 値 | 意味 |
|---|---|---|
| `driveSpeed` | **120** | 直進のモータPWM(0–255)。物理速度ではない。 |
| `turnSpeed` | **150** | その場旋回のPWM。 |
| `wallCm` | **20** | 前方20cm未満で旋回に切替。 |
| `turnTicks` | **4** | 旋回を4tick継続(≒480ms)＝実機で約90度。 |
| `tickMs` | **120** | 制御周期(1ループの間隔)。 |
| `turnDir` | **left** | 壁で左に回る(固定)。 |

### 速度について正直に
- **PWMは物理速度ではない**。`driveSpeed=120` が実際に何 cm/s かは**エンコーダが無いので未計測**。
- **firmware が自走系モードで PWM を 180 に上限クランプ**する（[types.ts:33] のコメント）。なので 120/150 はクランプ下で素直に効く。
- **目標値**は本物ルンバ基準で **巡航20〜30cm/s・旋回はゆっくり**（[research-roomba-speed-and-motion.md](research-roomba-speed-and-motion.md)）。実機を巻尺＋ストップウォッチで実測して `driveSpeed` を校正するのが次の宿題。
- **シム上の公称**（参考）：`maxDriveCmPerTick=4 @255`（[sim/model.ts:49]）→ tickMs=120 換算で speed255≈33cm/s、driveSpeed120≈16cm/s。**これはシムのモデル値で実機の実測ではない**。

### バック（後退）は？
- **ハードは可能**（TB6612逆転対応／firmware `N=3 D1=4`）。プロトコル上の方向定義にも後退の口はある。
- **だが頭脳に後退コマンドが無い**：`Command.kind` は `forward / rotateLeft / rotateRight / stop` の4種だけ（[types.ts:30]）。**現状ロボットは後退しない**。詰まり脱出をやるなら `reverse` を1種足す必要がある（[research-roomba-speed-and-motion §3](research-roomba-speed-and-motion.md)）。

---

## 3. 掃除アルゴリズム（現状）

### 状態機械は2つだけ（`app/src/domain/cleaning.ts`）
```
 ┌─ DRIVE(直進) ─┐  距離<20cm   ┌─ TURN(その場旋回) ─┐
 │ 前進し続ける    │ ──────────▶ │ turnTicks 回だけ回る │
 └────────────────┘ ◀────────── └─────────────────────┘
                     4tick 経過で直進へ復帰
```

- **DRIVE**：前方距離 `>0 かつ <20cm` になるまで直進。直進補正はfirmware(ジャイロ)任せ。
- **TURN**：その場で `turnTicks(=4)` tick 旋回したら直進へ戻る。**yawは見ない**（タイマ旋回）。
- **距離0は壁扱いしない**：エコー無し=`0`=「前方に何も無い(遠い)」なので、`>0` ガードで開けた場所の誤旋回を防ぐ（[cleaning.ts:40]）。
- **安全ゲート（離地）**：`liftStop` が true のとき持ち上げで停止。**実機の離地センサが不安定なので既定 OFF**（[config.ts:17]）。

### いま“無い”もの（roadmap §3 の未実装分）
スパイラル／壁伝い／ランダム反射（旋回角の乱数化）／詰まり脱出（後退）／**超音波スイープ（首振り）**／後退。**現状は「直進＋固定90度左旋回」だけ**で、ルンバの代表挙動はまだ入っていない。

---

## 4. センサ（今読んでいる/読んでいない）

| センサ | 接続 | 現状の使い方 |
|---|---|---|
| 超音波 HC-SR04 | D12/D13、**サーボZ(D10)上に搭載** | 毎tick `N=21 D1=2` で前方距離だけ取得。**正面固定・首振りしていない**。 |
| 離地 | firmware `N=23`(真偽反転) | 取得はするが既定で停止判定に使わない(`liftStop=false`)。 |
| IMU(MPU6050) yaw | I2C | **不使用**。実機 `read()` は yaw を問い合わせず 0 固定（chip_id不安定＋毎tickのタイムアウト遅延回避のため）[serial-robot.ts:23]。 |
| ライン×3(下向きIR) | A0/A1/A2 | **完全に未使用**（崖センサ転用の余地＝roadmap論点）。 |
| 電池電圧 | A3(分圧回路あり) | 回路はあるが**Web側プロトコルは電圧を問い合わせていない**。可視化は未実装。 |

> **1tickで超音波＋離地の2回問い合わせ**している（[serial-robot.ts:20-26]）。yawを足すと3回になり、特にWiFiで体感遅延が増えるため意図的に省いている。

---

## 5. カメラ

- **ESP32-WROVER-CAM の MJPEG ストリーム**を `http://192.168.4.1:81/stream` で配信（純正firmware）。[stage5-wireless-camera]
- ブラウザは `<img>` で表示するだけ。**WiFi接続が成功したときだけ表示**（[main.ts:83-88]）。USB接続では映像は出ない（カメラはESP32＝WiFi系のため）。
- **現状は“見るだけ”**。フレームを画像処理に使う（視覚自律）・緑レーザー重畳などは未実装（roadmap論点3/§3.4）。

---

## 6. 通信・制御ループ

- **制御ループ**（`app/src/runner.ts`）：`setInterval(tick, 120ms)`。各tickで `read → step → send`。
  - **多重起動防止**(`busy`)：前tickの非同期処理が終わるまで次を始めない。→ シリアル往復が120msより遅いと実効周期は自然に伸びる。
  - **停止後ガード**(`running`)：停止が押されたら送信しない。
- **接続は2系統**、頭脳は共通：
  - **USB**：Web Serial(`SerialTransport`)。ユーザー操作内で `requestPort`。
  - **WiFi**：`WebSocketTransport` → Node WS中継(`tools/ws-bridge.mjs`) → ESP32 TCP:100。中継が毎秒 `{Heartbeat}` を送り、`{Heartbeat}` はブラウザに流さない。[stage5-wireless-camera]
- **応答待ち** `TIMEOUT_MS=1500`。H不一致のフレーム（ACK/別センサ）は読み飛ばす（[serial-robot.ts:35]）。
- **緊急停止**：停止ボタン／Esc／Space で `stop` を**3回**送る（フレーム落ち対策）＋ループ停止（[main.ts:30-37]）。WiFiはブラウザ/中継を閉じればESP32が `{"N":100}` で自動停止（安全弁）。

---

## 7. 電源・バッテリ駆動時間

- **電源**：18650 リチウム ×2（公称 7.4V／満充電 ≈ 8.4V）。※正確なセル数・容量は実機要確認（[machine-reference §10]）。
- **電圧は読める回路がある**（A3・分圧×7.667・換算式あり）が、**現状アプリは取得していない**。残量%は電圧カーブからの粗推定になる。
- **駆動時間は未計測**。4WDモータ＋ESP32カメラ配信は電流を食うので、連続自走では**カタログ的に数十分オーダー**と見るのが妥当（正確値は実測課題）。
- **計測の宿題**：① 満充電→停止までを計時、② A3電圧を可視化して降下カーブを取る、③ 電圧低下でPWM一定でも減速する点に注意。

---

## 8. 首振り（サーボ）— 設計上できる。今していない。どう組み込むか

**事実**：超音波センサは**サーボZ(D10)の上に載っている**（[machine-reference §7.1]）。firmwareにサーボ角コマンド `N=5 D1=1 D2=角度(0–180)` がある（[machine-reference §9]）。**つまりハードは首を振れる。やっていないのはソフトが指令していないだけ**。

### なぜ今は固定正面か
頭脳は毎tick「正面の距離」だけ取得して直進/旋回を決めている。サーボを一切動かさないので、超音波は正面を向いたまま。

### 組み込み方（設計の筋。実装はstage化）
左/中/右をスキャンして**一番空いた方向へ曲がる**＝roadmap §3.1「超音波スイープ」。最小の追加は次の3点：

1. **プロトコルにサーボ指令を追加**：`encodeServo(angle)` → `{"H":..,"N":5,"D1":1,"D2":angle}`（純関数1個）。
2. **RobotIO にスキャン手段を足す**：`read()` は正面のまま据え置き、別に `scan(angles)` を設けて「角度→向ける→少し待つ→`N=21`で測る」を順に回し `{left, center, right}` を返す。**サーボの整定待ち**（SG90は60°/0.17s＝90°振りに約0.25s）が要るので、毎tickではなく**壁検知時だけ**スキャンするのが現実的。
3. **頭脳に分岐を追加**：DRIVEで壁を検知したら、スキャン結果で**最も距離が大きい方へ `turnDir` を選ぶ**（今の固定左を、空いた方優先に置換）。状態機械に `SCAN` 相を1つ足す形。

### 設計上の注意
- **首を振ると本体の正面距離計測のリズムが乱れる**：スキャン中は前進を止める（その場でサーボだけ動かす）と安全。
- **整定待ちでtickが伸びる**：スキャンtickだけ周期が長くなるのを許容する（`busy`ガードがあるので破綻はしない）。
- **サーボY(D11・縦)は未接続/任意**。横スイープはZのみで足りる。
- **テスト**：スキャン結果→`turnDir`選択は純関数にできる＝シム/単体で先に検証可。シム側 `model.ts` に「角度別レイキャスト」を足せば首振りもシムで再現できる。

→ **結論：首振りは新ハード不要・小さな追加で入る**。「正面しか見ない今のロボット」を「空いた方へ賢く曲がるロボット」にする最短の伸びしろ。

---

## 9. 現状の制約・既知の穴（正直に）

- **自己位置・地図が無い**（エンコーダ無し）。軌跡は推定すら未実装。網羅走行は不可。
- **後退しない**（Commandに無い）。詰まりからの脱出ができない。
- **yaw不使用**。旋回はタイマ依存＝床/電圧でばらつく（毎回ぴったり90度ではない）。
- **超音波は正面固定**。横/斜めの障害物は見えない（首振り未実装）。
- **掃除の実体が無い**。拭き/掃き/吸いはどれも未着手（走るだけ）。
- **離地センサ不安定**で安全停止は既定OFF。
- **電池/電流の可視化が無い**。走行時間・残量が分からない。

---

## 10. パラメータ早見表（再掲・`config.ts`）

| 名前 | 値 | 単位 | 触ると何が変わる |
|---|---|---|---|
| `wallCm` | 20 | cm | 小さいほど壁ギリギリまで直進 |
| `turnTicks` | 4 | tick | 大きいほど旋回角が増える(≒90度を調整) |
| `turnDir` | left | — | 旋回の向き |
| `driveSpeed` | 120 | PWM | 直進速度(firmware 180クランプ下) |
| `turnSpeed` | 150 | PWM | 旋回速度 |
| `tickMs` | 120 | ms | 制御周期。短いほど反応が速いが負荷増 |
| `liftStop` | false | — | 離地で止めるか(既定OFF) |

---

## 出典（実コード）

| タグ | 実体 |
|---|---|
| config | `app/src/config.ts` |
| types | `app/src/types.ts` |
| cleaning | `app/src/domain/cleaning.ts` |
| runner | `app/src/runner.ts` |
| serial-robot | `app/src/io/serial-robot.ts` |
| protocol | `app/src/protocol/protocol.ts` |
| sim/model | `app/src/sim/model.ts` |
| main | `app/src/main.ts` |
| stage4-timed-turn | `docs/project/stage4-timed-turn.md` |
| stage5-wireless-camera | `docs/project/stage5-wireless-camera.md` |
| machine-reference | `docs/reference/machine-reference.md` |

---
関連：[machine-reference.md](machine-reference.md)（キットの素性）／ [research-roomba-speed-and-motion.md](research-roomba-speed-and-motion.md)（目標値）／ [vision-autonomy-and-cleaning-roadmap.md](vision-autonomy-and-cleaning-roadmap.md)（未来）／ [cleaning-logic-spec.md](../project/cleaning-logic-spec.md)（判断ロジック仕様）
