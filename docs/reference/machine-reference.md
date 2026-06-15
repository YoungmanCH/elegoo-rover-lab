# ELEGOO Smart Robot Car Kit V4.0 マシンリファレンス

ELEGOO Smart Robot Car Kit V4.0（**TB6612 & MPU6050 構成 / 製品ファーム V1**）の性質・機能・特性をまとめた実用リファレンスです。
仕様の根拠は公式付属資料とファームウェアのソースコードから裏取りし、各項目に[出典タグ](#出典一覧)を付けています。

> **対象構成について**T
> このキットには製造ロットによるバリエーションがあります。本書は **モータドライバ=TB6612FNG / IMU=MPU6050(GY-521)** の組み合わせ（製品ファーム `SmartRobotCarV4.0_V1_20230201`）を対象とします。
> 他構成（モータドライバ `DRV8835`、IMU `QMI8658C`）はピン配置や一部仕様が異なります → [バリエーション](#11-バリエーション他構成との違い)参照。

---

## 1. 概要 — このマシンは何か

4輪駆動の小型自律走行ロボットカー。**2つのマイコンが役割分担する2階建て構成**が最大の特徴です。

- **Arduino UNO R3** … センサ読み取りとモータ・サーボ制御を担う「現場担当」。ユーザがコードを書き換える対象。
- **ESP32-WROVER-CAM** … WiFi・カメラ・スマホアプリ通信を担う「ゲートウェイ」。UNO とは**シリアル通信**でつながる。出荷時に書き込み済みで、改変は非推奨。[PRIN]

標準ファームだけで以下のモードを内蔵します（詳細は[§8](#8-動作モード内蔵ファーム機能)）。

| 機能 | 概要 |
|---|---|
| 走行制御 | 前進・後退・旋回・カーブ・速度可変 |
| ライントラッキング | 床の黒線に沿って走行 |
| 障害物回避 | 超音波で前方を測り、避けて走行 |
| フォロー | 前方の物体を一定距離で追従 |
| サーボ制御 | 超音波センサの向きを左右に振る |
| スマホアプリ操作 | ESP32 の WiFi 経由でジョイスティック操作＋カメラ映像 |
| 赤外線リモコン操作 | 付属 IR リモコンで操作 |
| RGB LED 表示 | 状態表示用フルカラー LED |

---

## 2. システム構成

```
                 [スマホアプリ / Webブラウザ]
                          │ WiFi (2.4GHz)
                          ▼
   ┌──────────────────────────────────────┐
   │  ESP32-WROVER-CAM                     │  ← WiFi・カメラ・通信（出荷時書込済）
   │  Camera / WiFi / Communication        │
   └──────────────────────────────────────┘
                          │ シリアル通信 (UART, D0/D1)
                          ▼
   ┌──────────────────────────────────────┐
   │  Arduino UNO R3 (ATmega328P)          │  ← ユーザが書き換える本体
   │  Application Function → Device Drive  │
   └──────────────────────────────────────┘
        │        │        │        │       │
     Motor   Ultrasonic  Line   Servo   IMU/RGB/...
   (TB6612)  (HC-SR04)  (ITR20001) (SG90) (MPU6050)
```

役割分担の出典は実装原理図 [PRIN]。UNO 側は「Application Function（動作ロジック）」→「Device Drive（デバイス駆動）」の2層で、Motor / RGB LED / Key / Voltage / Ultrasonic / ITR20001 / Servo / Serial を駆動。ESP32 側は Camera / WiFi / Communication を担当し、両者は Serial で接続。

---

## 3. 主要コンポーネント一覧

| コンポーネント | 型番・規格 | 役割 | 接続 | 出典 |
|---|---|---|---|---|
| メインMCU | Arduino UNO R3 (ATmega328P) | 本体制御 | — | [PRIN] |
| 通信・カメラMCU | ESP32-WROVER-CAM | WiFi/BT・カメラ・アプリ通信 | UNO と UART | [ESP][PRIN] |
| モータドライバ | TB6612FNG | DCモータ駆動（2ch） | D3/5/6/7/8 | [TB][FW-h] |
| DCモータ ×4 | ギヤードDCモータ | 走行 | TB6612 出力 | [SHIELD-TB] |
| 超音波センサ | HC-SR04 相当 | 前方距離測定 | D12/D13 | [FW-h] |
| ライントラッキング | LTI-PCB（ITR20001 ×3） | 黒線検出（L/M/R） | A0/A1/A2 | [SHIELD-LT][FW-h] |
| IMU | MPU6050（GY-521モジュール） | 角速度・加速度 | I2C(A4/A5) | [GY][FW-h] |
| サーボ | SG90 ×1〜2 | センサの向き変更 | D10/D11 | [FW-h][FW-cpp] |
| RGB LED | WS2812（NeoPixel）×1 | 状態表示 | D4 | [FW-h][FW-cpp] |
| 電圧検出回路 | 分圧抵抗 10kΩ/1.5kΩ | 電池電圧監視 | A3 | [FW-cpp][SHIELD-TB] |
| ボタン | タクトスイッチ | モード起動 | D2 (INT0) | [FW-h][FW-cpp] |
| 赤外線受信 | IR受信モジュール（NEC） | リモコン受信 | D9 | [FW-h] |
| 拡張シールド | SmartCar-Shield V1.1 (TB6612) | 配線集約 | UNO 上に搭載 | [SHIELD-TB] |

---

## 4. ピンマッピング（確定版）

ファームウェア `DeviceDriverSet_xxx0.h` の TB6612 構成定義が確定値です。[FW-h]
（コメントアウトされた別構成の番号は無視し、有効な `#define` のみ記載）

### デジタルピン

| ピン | 用途 | 定数名 | 向き | 出典 |
|---|---|---|---|---|
| D0 (RX) | ESP32 とのシリアル受信 | — | IN | [SHIELD-TB] |
| D1 (TX) | ESP32 とのシリアル送信 | — | OUT | [SHIELD-TB] |
| D2 | ボタン（外部割込 INT0, FALLING） | `PIN_Key` | IN_PULLUP | [FW-h:45][FW-cpp:95] |
| D3 | モータ STBY（HIGH=有効/LOW=停止） | `PIN_Motor_STBY` | OUT | [FW-h:110] |
| D4 | RGB LED（WS2812 データ） | `PIN_RBGLED` | OUT | [FW-h:28] |
| D5 | モータA PWM（速度・右） | `PIN_Motor_PWMA` | OUT(PWM) | [FW-h:106] |
| D6 | モータB PWM（速度・左） | `PIN_Motor_PWMB` | OUT(PWM) | [FW-h:107] |
| D7 | モータA 方向（右） | `PIN_Motor_AIN_1` | OUT | [FW-h:109] |
| D8 | モータB 方向（左） | `PIN_Motor_BIN_1` | OUT | [FW-h:108] |
| D9 | 赤外線リモコン受信 | `RECV_PIN` | IN | [FW-h:168] |
| D10 | サーボ Z（水平・首振り） | `PIN_Servo_z` | OUT(PWM) | [FW-h:152] |
| D11 | サーボ Y（垂直・任意） | `PIN_Servo_y` | OUT(PWM) | [FW-h:153] |
| D12 | 超音波 ECHO | `ECHO_PIN` | IN | [FW-h:136] |
| D13 | 超音波 TRIG | `TRIG_PIN` | OUT | [FW-h:135] |

### アナログピン

| ピン | 用途 | 定数名 | 出典 |
|---|---|---|---|
| A0 | ライントラッキング 右 (R) | `PIN_ITR20001xxxR` | [FW-h:71] |
| A1 | ライントラッキング 中 (M) | `PIN_ITR20001xxxM` | [FW-h:70] |
| A2 | ライントラッキング 左 (L) | `PIN_ITR20001xxxL` | [FW-h:69] |
| A3 | 電池電圧検出 | `PIN_Voltage` | [FW-h:84] |
| A4 | I2C SDA（MPU6050） | （Wire） | [SHIELD-TB] |
| A5 | I2C SCL（MPU6050） | （Wire） | [SHIELD-TB] |

> **メモ**: ほぼ全ピンを使い切る構成。`L/M/R` のアナログ割当は基板リビジョンで入れ替わる（旧"03"基板は L=A0/R=A2、現"04"基板は L=A2/R=A0）。[FW-h:64-71]

---

## 5. モータ駆動系（TB6612FNG）

### チップ定格 [TB]

| 項目 | 値 | 備考 |
|---|---|---|
| モータ電源電圧 VM | 最大 15V（動作 2.5〜13.5V） | [TB] Absolute Max / 動作範囲 |
| 制御ロジック電圧 VCC | 2.7〜5.5V | Arduino の 5V で駆動 |
| 出力電流 | 1.2A（平均）/ 3.2A（ピーク） | 1chあたり |
| PWM 周波数 | 最大 100kHz | |
| スタンバイ | STBY="L" で省電力停止 | 消費電流ほぼゼロ |

### 制御方法 [FW-cpp:207-268]

- モータA = **右**、モータB = **左**（`DeviceDriverSet_Motor_control` 内コメント）
- 方向: `AIN_1`/`BIN_1` を HIGH=正転(`direction_just`) / LOW=逆転(`direction_back`)
- 速度: `PWMA`/`PWMB` に `analogWrite(0〜255)`
- 停止: `direction_void`(=3) で PWM=0 かつ STBY=LOW

| 操作 | AIN/BIN | PWM | STBY |
|---|---|---|---|
| 正転 | HIGH | 速度(0〜255) | HIGH |
| 逆転 | LOW | 速度(0〜255) | HIGH |
| 停止 | — | 0 | LOW |

走行パターン（左右の回転差で操舵：左右逆回転=その場旋回、片輪減速=カーブ）は別資料 [docs/demo1-tb6612-mpu6050.md](../basics/demo1-tb6612-mpu6050.md) に詳細あり。

---

## 6. センサ系

### 6.1 超音波センサ（HC-SR04 相当）[FW-cpp:278-298]

| 項目 | 値 |
|---|---|
| 接続 | TRIG=D13 / ECHO=D12 |
| 距離計算 | `距離cm = pulseIn(ECHO,HIGH) / 58` |
| 測定上限 | ファームの `*_Get()` は 150cm に上限クランプ（`MAX_DISTANCE` 定義は 200cm）[FW-h:137] |
| 測定手順 | TRIG を 10µs HIGH → エコー往復時間を計測 |

### 6.2 ライントラッキング（LTI-PCB / ITR20001 ×3）[SHIELD-LT][FW-cpp:110-142]

- 反射型赤外センサ ITR20001 を 3個（左・中・右）搭載した基板 `LTI-PCB-V1.0`
- 各センサに 200Ω / 10kΩ。出力は**アナログ値**を `analogRead`（0〜1023）で取得
- 白い床＝反射大、黒線＝反射小。3点の値で線の位置を判定
- 接続: L=A2 / M=A1 / R=A0

### 6.3 IMU（MPU6050 / GY-521モジュール）[GY][FW-cpp(MPU)]

| 項目 | 値 | 出典 |
|---|---|---|
| 構成 | 3軸ジャイロ + 3軸加速度 + DMP（4×4×0.9mm） | [GY] |
| ジャイロ フルスケール | ±250 / ±500 / ±1000 / ±2000 °/s（16bit ADC） | [GY] |
| 加速度 フルスケール | ±2 / ±4 / ±8 / ±16 g（16bit ADC） | [GY] |
| インターフェース | I2C（最大400kHz）, アドレス 0x68 | [GY] |
| センサ電源 VDD | 2.375〜3.46V（GY-521モジュールは3.3Vレギュレータ搭載で5Vトレラント） | [GY] |
| **ファームでの実利用** | **Z軸ジャイロのみ**を使用。`gz/131.0` を時間積分して Yaw（方位角）を算出。起動時に100回サンプリングしてゼロ点補正 | [FW-cpp(MPU):56-83] |

> ファームは IMU の全能力のうち「Z軸の旋回角」しか使っていません（直進補正・旋回角度制御用）。加速度や他軸は未使用で、拡張の余地があります。

---

## 7. アクチュエータ・出力

### 7.1 サーボ（SG90）[FW-cpp:330-422]

| 項目 | 値 |
|---|---|
| 接続 | Z（水平）=D10 / Y（垂直, 任意）=D11 |
| パルス幅 | 500µs(0°) 〜 2400µs(180°) |
| 速度 | 0.17 sec / 60°（@4.8V）|
| 用途 | 標準車は Z サーボで超音波センサを左右に首振り |

### 7.2 RGB LED（WS2812 / FastLED）[FW-cpp:39-70]

- NeoPixel 1個、D4。`FastLED` ライブラリで任意の色・明るさを指定可能。

### 7.3 赤外線リモコン受信（NEC）[FW-h:168-205][FW-cpp:424-508]

- D9。`IRremote` ライブラリ。上下左右・OK・数字1〜9を受信コードでデコード（A/B 2種のリモコンコードに対応）。

---

## 8. 動作モード（内蔵ファーム機能）

`loop()` は毎周回で全モードのハンドラを呼び、状態に応じて該当モードだけ動作する設計。[FW-ino]

```
loop(): SensorDataUpdate → KeyCommand → RGB → Follow → Obstacle
        → Tracking → Rocker → Standby → IRrecv → SerialPortDataAnalysis
        → CMD_*（シリアルコマンド処理群）
```

| モード | 起動方法 | 概要 | チュートリアル |
|---|---|---|---|
| ライントラッキング | アプリ N=101 D1=1 / ボタン | 黒線追従 | 03 Tracking |
| 障害物回避 | アプリ N=101 D1=2 / ボタン | 超音波で回避走行 | 05 Obstacle |
| フォロー | アプリ N=101 D1=3 / ボタン | 物体追従 | 06 Follow |
| サーボ制御 | アプリ N=5 | センサ首振り | 04 ServoControl |
| ジョイスティック操作 | アプリ N=102 | 任意方向に手動走行 | 08 DIY & APP |
| 赤外線リモコン | IRリモコン | 手動操作 | 07 Others |

ウォッチドッグタイマ（`wdt_enable(WDTO_2S)`）で2秒以内に応答が無いと自動リセット。[FW-ino]

---

## 9. 通信プロトコル（シリアル / JSON）★Web化の足がかり

ESP32 ↔ UNO 間および外部からの制御は **JSON 文字列**でやり取りする（`ArduinoJson v6.11.1` 使用）。
`"H"` はコマンドID（応答 `{ID_ok}` でエコーバック）、`"N"` はコマンド種別、`"D1..D3"` はパラメータ。[PROTO]

### 制御コマンド（→ ロボットへ）

| N | 機能 | パラメータ | 例 |
|---|---|---|---|
| 1 | モータ個別制御 | D1=対象(0全/1左/2右), D2=速度0-255, D3=方向(1時計/2反時計) | `{"H":1,"N":1,"D1":1,"D2":150,"D3":1}` |
| 3 | 車体の方向＋速度 | D1=方向(1左/2右/3前/4後), D2=速度0-255 | `{"H":1,"N":3,"D1":3,"D2":150}` |
| 4 | 左右輪を個別速度指定 | D1=左速度, D2=右速度 | `{"H":1,"N":4,"D1":150,"D2":150}` |
| 5 | サーボ角度 | D1=サーボ(1左右/2上下), D2=角度0-180 | `{"H":1,"N":5,"D1":1,"D2":90}` |
| 100 | 全機能クリア（ジョイスティック） | — | `{"N":100}` |
| 101 | モード切替 | D1=1追従/2回避/3フォロー | `{"N":101,"D1":2}` |
| 102 | ジョイスティック移動（既定最大速） | D1=方向1-8, D2=速度 | `{"N":102,"D1":1,"D2":150}` |
| 104 | 追従感度（閾値）調整 | D1=50〜1000 | `{"N":104,"D1":300}` |
| 106 | カメラ回転 | D1=1上/2下/3左/4右 | `{"N":106,"D1":1}` |
| 110 | 全機能クリア（スタンバイに入らない） | — | `{"H":1,"N":110}` |

※ N=102 の方向: 1前/2後/3左/4右/5左前/6左後/7右前/8右後。[PROTO]
※ 2023版で N=102 に速度制御 `D2` が追加された。[FW-README]

### センサ取得コマンド（← ロボットから）

| N | 機能 | パラメータ | 戻り値 |
|---|---|---|---|
| 21 | 超音波 | D1=1障害物判定/2距離値 | `{ID_true/false}` または `{距離値}` |
| 22 | ライン(IR)センサ値 | D1=0左/1中/2右 | `{ID_センサ値}` |
| 23 | 車体が地面から離れたか | — | `{ID_true/false}` |

> **これがデジタルツイン/Web操作構想の核心**: プロトコルを自作する必要がなく、**既定の JSON コマンドで操作（N=1〜5,102）もテレメトリ取得（N=21〜23）も既に可能**。電圧（A3）を加えれば「電圧・距離・ライン・姿勢・離地」をブラウザに流せる。詳細な拡張案は[§12](#12-拡張余地--デジタルツインweb化への足がかり)。

---

## 10. 電源系とバッテリ監視

### 電源 [SHIELD-TB]
- 拡張シールドに `POWER_IN`（電池入力）。**18650 リチウム電池**で駆動（電池ボックスのセル構成は実機で要確認。一般的なV4.0は2セル≒公称7.4V・満充電約8.4V）。
- 電源スイッチ（SW-SPST）で全体をON/OFF。

### バッテリ電圧監視 ★標準で配線済み [FW-cpp:144-157][SHIELD-TB]
このキットは **電池電圧を A3 で読める回路を最初から持っています**（前回の議論の答え）。

- 分圧抵抗 **R1=10kΩ / R4=1.5kΩ**（分圧比 (10+1.5)/1.5 ≈ **×7.667**）で電池電圧を 5V 以下に落として A3 に入力。
- ファームの換算式（`DeviceDriverSet_Voltage_getAnalogue`）:
  ```cpp
  float Voltage = (analogRead(PIN_Voltage) * 0.0375);   // 0.0375 ≒ (5.0/1024)*7.67
  Voltage = Voltage + (Voltage * 0.08);                 // 8% 補正
  return Voltage;                                        // 単位: V
  ```
- つまり追加部品ゼロで電池電圧[V]が取得可能。残量%への変換はリチウムの電圧カーブ上ざっくり推定になる。
- **取得できないもの**: 電流・消費電力・正確なSoC（→ 別途 INA219 等の電流センサが必要）。また車輪エンコーダが無いため**正確な走行距離・自己位置は取得不可**（IMUと指令からの推測に限られ、誤差が蓄積）。

---

## 11. ファームウェア構成と開発環境

### 11.1 ソース構成（製品ファーム `SmartRobotCarV4.0_V1_20230201`）

| ファイル | 役割 |
|---|---|
| `SmartRobotCarV4.0_V1_20230201.ino` | メイン（setup/loop） |
| `ApplicationFunctionSet_xxx0.h/.cpp` | 動作ロジック層（各モード・コマンド解釈） |
| `DeviceDriverSet_xxx0.h/.cpp` | デバイス駆動層（ピン制御のHAL） |
| `MPU6050_getdata.h/.cpp` | IMUからYaw角を算出 |
| 同梱ライブラリ | `ArduinoJson v6.11.1` / `FastLED` / `IRremote` / `MPU6050`+`I2Cdev` / `Servo` |

**2層アーキテクチャ**: 上位の Application（何をするか）と下位の DeviceDriver（どう動かすか）を分離。チュートリアルの `Demo1`〜`Demo4` はこの一部を切り出した学習用サンプル。

### 11.2 開発環境 [PREP]
- **Arduino IDE**（UNO 側の書き込み）
- **CH340 USBシリアルドライバ**（付属。UNO の USB-シリアル変換用。Linux/Mac/Win 版が同梱）
- ライブラリは付属の `.zip` を Arduino IDE に取り込む
- ESP32 側コードをビルドする場合: Board=**ESP32 Dev Module** / Partition=**Huge APP (3MB No OTA)** / **PSRAM=enabled**（ただし出荷時書込済のため通常は触らない）[ESP-NOTES]

### 11.3 バリエーション（他構成との違い）
| 部位 | 本書の対象 | 他構成 |
|---|---|---|
| モータドライバ | TB6612FNG | DRV8835（ピン配置・データシート別） |
| IMU | MPU6050 (GY-521) | QMI8658C |

ピン定義・対応ファームが異なるため、実機のチップ刻印を確認して対応する `02 Main Program` / `03 Tutorial` のフォルダを使うこと。

---

## 12. 拡張余地 — デジタルツイン/Web化への足がかり

手持ち構成で実現可能な発展方向（前回の議論の整理）:

| やりたいこと | 実現性 | 必要なもの |
|---|---|---|
| Webブラウザから操作 | ◎ | ESP32 経由で既定 JSON コマンド(N=3/102 等)を送る |
| 距離・ライン・姿勢・離地の可視化 | ◎ | N=21/22/23 ＋ IMU Yaw を取得して画面表示 |
| 電池電圧の可視化 | ◎ | A3 を読むだけ（配線済・式あり） |
| 消費電流・電力の可視化 | ○ | INA219 等の電流センサを追加（I2C） |
| 正確な自己位置/地図 | △ | 車輪エンコーダが無く誤差蓄積。IMU+指令の推測のみ |
| カメラ映像配信 | ○ | ESP32-WROVER-CAM の機能（出荷時ファーム or 同梱 ESP32 カメラコード） |

→ **プロトコルが既に定義済みなので、「自作Webダッシュボード ←→ ESP32 ←→ UNO」の構成にすれば操作と可視化の両方を発明せずに作れる**のが強み。位置推定だけは原理的に限界があると割り切るのが現実的。

---

## 出典一覧

すべて配布物のルート `ELEGOO Smart Robot Car Kit V4.0 2023.02.01/` 配下。

| タグ | ファイル |
|---|---|
| [FW-ino] | `02 Manual & Main Code & APP/02 Main Program (Arduino UNO)/TB6612 & MPU6050/SmartRobotCarV4.0_V1_20230201/SmartRobotCarV4.0_V1_20230201.ino` |
| [FW-h] | 同上フォルダ `DeviceDriverSet_xxx0.h`（行番号付きで引用） |
| [FW-cpp] | 同上フォルダ `DeviceDriverSet_xxx0.cpp` |
| [FW-cpp(MPU)] | 同上フォルダ `MPU6050_getdata.cpp` |
| [FW-README] | 同上フォルダ `README.txt`（変更履歴） |
| [PROTO] | `04 Related chip information/Communication protocol for Smart Robot Car.pdf` |
| [PRIN] | `03 Tutorial & Code/01 SmartRobotCarV4.0_Preparation/Implementation principle of SmartRobot Car.pdf` |
| [TB] | `04 Related chip information/TB6612FNG.pdf` |
| [GY] | `04 Related chip information/GY-521 Module Datasheet.pdf` |
| [ESP] | `04 Related chip information/ESP32-wrover_datasheet_en.pdf` |
| [SHIELD-TB] | `04 Related chip information/SmartRobot-Shield(TB6612).pdf`（回路図 SmartCar-Shield-V1.1） |
| [SHIELD-LT] | ライントラッキング基板回路図 `LTI-PCB-V1.0`（ITR20001 ×3） |
| [PREP] | `03 Tutorial & Code/01 SmartRobotCarV4.0_Preparation/`（環境構築PDF・How to add .zip Library） |
| [ESP-NOTES] | `02 Manual & Main Code & APP/04 Code of Carmer (ESP32)/.../Notes.txt` |
| [MANUAL] | `02 Manual & Main Code & APP/01 User Manual/User Manual（EN）20220816.pdf`（※スキャン画像PDFのためテキスト抽出不可） |

> **未確認事項（要実機/原本確認）**
> - 電池ボックスの正確なセル数・定格電圧（[MANUAL] が画像PDFのため数値未抽出）
> - ESP32 カメラの撮像素子型番（OV2640 と推定。`Camera module FAQ.pdf` / `ESP32-WROVER-Camera-V1.2.pdf` 要確認）
