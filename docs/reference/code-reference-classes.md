# コードリファレンス：既存クラス・関数カタログ（機能別）

> **なぜこの文書があるか**：今回使う機能はすべて既存コードにクラス／関数として実装済み。**正確なシグネチャと実装**を機能別に棚卸ししておく。
> **なんのために**：C++ でそのまま呼ぶにせよ、TS で挙動を再現するにせよ、「どの関数が・何を引数に・何を返すか」を毎回ソースに潜らず参照できるようにするため。
> **だれのために**：実装する自分。実装中に開く API リファレンス。

出典タグ（**メインプログラム**配下＝最も完全。ルートは [research-route-and-avoidance.md](research-route-and-avoidance.md) と同じ）。

| タグ | ファイル |
|---|---|
| `[Dev.h]` / `[Dev]` | `DeviceDriverSet_xxx0.h` / `.cpp`（HAL層） |
| `[App.h]` / `[App]` | `ApplicationFunctionSet_xxx0.h` / `.cpp`（アプリ層） |
| `[MPU.h]` / `[MPU]` | `MPU6050_getdata.h` / `.cpp`（IMU） |

> 注意：各チュートリアルのデモにも同名クラスの**簡易版**があるが、本書は機能が最も揃うメインプログラムを正本とする。

---

# A. アプリ層：`ApplicationFunctionSet` [App.h]

**役割（なぜ）**：センサ更新・各モード・外部コマンド解釈を束ねる最上位クラス。我々が外部（シリアル）から触る窓口はすべてここ。

### A-1. モード／ハンドラ系メソッド [App.h:17-30]
```cpp
void ApplicationFunctionSet_Init(void);                 // 全デバイス初期化＋IMU校正
void ApplicationFunctionSet_SensorDataUpdate(void);     // 電圧・ライン・離地を更新
void ApplicationFunctionSet_Obstacle(void);             // 障害物回避（=掃除の素）
void ApplicationFunctionSet_Tracking(void);             // ライン追従
void ApplicationFunctionSet_Servo(uint8_t Set_Servo);   // サーボ制御
void ApplicationFunctionSet_SerialPortDataAnalysis(void);// シリアル(JSON)受信・解釈
```

### A-2. 外部コマンド＝シリアル JSON プロトコル [App:1771-2032]
受信は `'}'` までを1フレームとして読み、`StaticJsonDocument<200>` で `deserializeJson`。`doc["N"]`＝コマンド種別、`doc["H"]`＝コマンド番号（応答にエコー）、`doc["D1..D4"]`＝引数。[App:1777-1812]

```cpp
while (c != '}' && Serial.available() > 0) { c = Serial.read(); SerialPortData += (char)c; }
...
int control_mode_N = doc["N"];
char *temp = doc["H"]; CommandSerialNumber = temp;   // 応答に {H_...} で返す
switch (control_mode_N) { /* 下表 */ }
```

| N | 機能 | 引数 | 出典 |
|---|---|---|---|
| 1 | モータ個別制御（モード=CMD_MotorControl） | D1=選択,D2=速度,D3=方向 | [App:1817] |
| 2 | 車体方向＋速度（時間制限あり） | D1=方向,D2=速度,T=時間 | [App:1828] |
| 3 | 車体方向＋速度（時間制限なし） | D1=方向,D2=速度 | [App:1839] |
| 4 | 左右輪を個別速度 | D1=左,D2=右 | [App:1848] |
| 5 | サーボ角度 | D1=サーボ,D2=角度 | [App:1856] |
| 7/8 | RGB点灯（時間あり/なし） | D1=位置,D2-4=RGB,T=時間 | [App:1864/1878] |
| 21 | **超音波取得** | D1=1:障害物真偽 / 2:距離値 | [App:1890] |
| 22 | **ライン取得** | D1=0/1/2 (L/M/R) | [App:1897] |
| 23 | **離地取得** | — | [App:1904] |
| 100 | 全機能クリア→スタンバイ | — | [App:1925] |
| 101 | モード切替 | D1=1追従/2回避/3フォロー | [App:1933] |
| 102 | ロッカー（ジョイスティック） | D1=方向1-9,D2=速度 | [App:1983] |
| 105 | LED輝度±5 | D1=1up/2down | [App:1953] |
| 106 | サーボ群制御 | D1=1-5 | [App:1970] |

**応答フォーマット**：`{<H>_ok}`＝受理ack、`{<H>_<値>}`＝数値、`{<H>_true}`/`{<H>_false}`＝真偽。`_is_print` 有効時のみ送信。[App:1823-1824]

### A-3. テレメトリ応答の中身（我々の可視化が読む値）
```cpp
// N=21：超音波 [App:1517-1544]
void CMD_UltrasoundModuleStatus_xxx0(uint8_t is_get) {
  AppULTRASONIC.DeviceDriverSet_ULTRASONIC_Get(&UltrasoundData_cm);
  if (1 == is_get)  /* {H_true/false}（20cm以内に障害物か） */
  else if (2 == is_get) { char s[10]; sprintf(s,"%d",UltrasoundData_cm); /* {H_<cm>} */ }
}
// N=22：ライン生値 [App:1550-1611]  D1=0/1/2 → {H_<TrackingData_L/M/R>}（analogRead生値）
// N=23：離地 [App:1904-1917]  ※反転に注意：接地(Car_LeaveTheGround=false)→ "{H_true}" / 浮く(=true)→ "{H_false}"
```

### A-4. しきい値・状態変数 [App.h:73-86]
```cpp
boolean Car_LeaveTheGround = true;        // 離地フラグ：true=床から離れている（SensorDataUpdateが更新）
const float   VoltageDetection = 7.00;    // 低電圧しきい値[V]
const uint8_t ObstacleDetection = 20;     // 障害物しきい値[cm]
uint8_t  TrackingDetection_S = 250;       // ライン判定 下限
uint16_t TrackingDetection_E = 850;       // ライン判定 上限
uint16_t TrackingDetection_V = 950;       // 離地判定しきい値
```
**使いどころ**：我々の掃除しきい値（壁手前で曲がる距離）は `ObstacleDetection` 相当の値をそのままチューニング対象にできる。

---

# B. HAL層：`DeviceDriverSet_*`（デバイス駆動）

## B-1. モータ `DeviceDriverSet_Motor` [Dev.h:88-121][Dev:170-268]
**役割**：左右モータの方向・速度を1関数で制御。すべての走行はここに帰着。
```cpp
void DeviceDriverSet_Motor_Init(void);
void DeviceDriverSet_Motor_control(boolean direction_A, uint8_t speed_A,   // A=右
                                   boolean direction_B, uint8_t speed_B,   // B=左
                                   boolean controlED);                     // 有効化
```
キー実装（方向はピンHIGH/LOW、速度はPWM、停止はSTBY=LOW）[Dev:218-232]：
```cpp
case direction_just: digitalWrite(PIN_Motor_AIN_1, HIGH); analogWrite(PIN_Motor_PWMA, speed_A); break;
case direction_back: digitalWrite(PIN_Motor_AIN_1, LOW);  analogWrite(PIN_Motor_PWMA, speed_A); break;
case direction_void: analogWrite(PIN_Motor_PWMA, 0); digitalWrite(PIN_Motor_STBY, LOW); break;
```
- ピン[Dev.h:106-110]：`PWMA=5, PWMB=6, BIN_1=8, AIN_1=7, STBY=3`。**A=右輪 / B=左輪**[Dev:182-183]。
- 定数[Dev.h:112-120]：`direction_just=true(正転), direction_back=false(逆転), direction_void=3(停止), speed_Max=255, control_enable=true`。
- **使いどころ**：TSでは触れない（純正FW内部）。直接駆動は A-2 の `N=3`(車体方向)／`N=4`(左右輪個別)で間接的に叩く。

## B-2. 超音波 `DeviceDriverSet_ULTRASONIC` [Dev.h:125-138][Dev:273-298]
**役割**：前方距離[cm]を測る。壁検知の唯一の入力。
```cpp
void DeviceDriverSet_ULTRASONIC_Init(void);
void DeviceDriverSet_ULTRASONIC_Get(uint16_t *ULTRASONIC_Get /*out*/);   // cm, 150クランプ
```
```cpp
tempda_x = ((unsigned int)pulseIn(ECHO_PIN, HIGH) / 58);
*ULTRASONIC_Get = (tempda_x > 150) ? 150 : tempda_x;   // [Dev:286-296]
```
- ピン[Dev.h:135-137]：`TRIG=13, ECHO=12, MAX_DISTANCE=200`。
- **使いどころ**：掃除ロジックの主入力。TSからは `N=21,D1=2` で cm を取得。

## B-3. サーボ `DeviceDriverSet_Servo` [Dev.h:141-154][Dev:330-422]
**役割**：超音波センサの首振り。回避の左右確認や、レーダー描画に使える。
```cpp
void DeviceDriverSet_Servo_Init(unsigned int Position_angle);
void DeviceDriverSet_Servo_control(unsigned int Position_angle);            // Servo_z を即時に角度へ
void DeviceDriverSet_Servo_controls(uint8_t Servo, unsigned int Position_angle);
```
```cpp
void DeviceDriverSet_Servo_control(unsigned int Position_angle){            // [Dev:382-388]
  myservo.attach(PIN_Servo_z); myservo.write(Position_angle); delay_xxx(450); myservo.detach();
}
```
- ピン[Dev.h:152-153]：`Servo_z=10（水平/首振り）, Servo_y=11`。パルス500–2400µs=0–180°[Dev:332]。
- 注意：`control` は1回 **450ms ブロッキング**（attach→write→待ち→detach）。
- **使いどころ**：sweep を使うなら `N=5`。単純版掃除では未使用でも可。

## B-4. ライン `DeviceDriverSet_ITR20001` [Dev.h:52-72][Dev:111-129]
**役割**：床の反射を3点で読む。ライン追従＝“物理経路”と、離地判定の入力。
```cpp
bool DeviceDriverSet_ITR20001_Init(void);
int  DeviceDriverSet_ITR20001_getAnaloguexxx_L(void);   // return analogRead(...)
int  DeviceDriverSet_ITR20001_getAnaloguexxx_M(void);
int  DeviceDriverSet_ITR20001_getAnaloguexxx_R(void);
```
- ピン[Dev.h:69-71]（04基板）：`L=A2, M=A1, R=A0`（旧03基板は L/R 逆）。
- **使いどころ**：経路を黒テープで定義する案（research §2-B）を採る場合の主入力。TSからは `N=22,D1=0/1/2`。

## B-5. 電圧 `DeviceDriverSet_Voltage` [Dev.h:74-85][Dev:150-157]
**役割**：電池電圧[V]。残量の目安・低電圧警告。
```cpp
float DeviceDriverSet_Voltage_getAnalogue(void);
```
```cpp
float Voltage = (analogRead(PIN_Voltage) * 0.0375);   // 0.0375 ≒ (5/1024)*7.67  [Dev:153-156]
Voltage = Voltage + (Voltage * 0.08);                 // 8%補正
```
- ピン[Dev.h:84]：`A3`。分圧 10k/1.5k。
- **使いどころ**：可視化したいが**純正シリアルプロトコルに取得コマンドが無い**（A-2にN無し）。出すなら**別コマンド（例 `N=25`）を自前追加**する（`N=24` は Yaw 用＝旋回制御に必要なので役割を分ける）。詳細は [code-design §5](../project/code-design.md)。

## B-6. RGB LED `DeviceDriverSet_RBGLED` [Dev.h:16-32][Dev:26-70]
**役割**：状態表示（モード色・電圧警告）。
```cpp
void DeviceDriverSet_RBGLED_Init(uint8_t set_Brightness);
void DeviceDriverSet_RBGLED_Color(uint8_t LED_s, uint8_t r, uint8_t g, uint8_t b);
void DeviceDriverSet_RBGLED_xxx(uint16_t Duration, uint8_t Traversal_Number, CRGB colour);
```
- ピン[Dev.h:28-29]：`PIN_RBGLED=4, NUM_LEDS=1`、FastLED の NEOPIXEL。
- **使いどころ**：今回は任意。掃除ON/OFF等の状態表示に使える程度。

## B-7. ボタン `DeviceDriverSet_Key` [Dev.h:35-49][Dev:72-108]
**役割**：本体ボタンでモード送り。外部割込(INT0,FALLING)で `keyValue` を 0→4 巡回。
```cpp
void DeviceDriverSet_Key_Init(void);              // attachInterrupt(0, ..., FALLING)
void DeviceDriverSet_key_Get(uint8_t *get_keyValue);
```
- ピン[Dev.h:45]：`PIN_Key=2`。**使いどころ**：今回は基本未使用。

## B-8. 赤外リモコン `DeviceDriverSet_IRrecv` [Dev.h:157-206][Dev:424-508]
**役割**：付属IRリモコン受信（NEC）。手動操作のフォールバック。
```cpp
void DeviceDriverSet_IRrecv_Init(void);
bool DeviceDriverSet_IRrecv_Get(uint8_t *IRrecv_Get /*out*/);   // 押下キーを 1..14 に正規化
```
- ピン[Dev.h:168]：`RECV_PIN=9`。**使いどころ**：当日デモのフォールバック操作（フォールバック段位3）。

---

# C. IMU：`MPU6050_getdata` [MPU.h][MPU]

**役割**：ジャイロZ軸から Yaw（方位角）を積分算出。直進補正と「角度ベース旋回」の素。
```cpp
bool MPU6050_dveInit(void);                      // I2C/デバイス初期化
bool MPU6050_calibration(void);                  // 起動時100回サンプルでゼロ点 gzo を取る [MPU:56-68]
bool MPU6050_dveGetEulerAngles(float *Yaw);      // Yaw を返す（積分値）
```
キー実装（角速度を時間積分。微小値はデッドバンドで0に）[MPU:69-83]：
```cpp
gz = accelgyro.getRotationZ();
float gyroz = -(gz - gzo) / 131.0 * dt;          // dt=前回からの経過秒
if (fabs(gyroz) < 0.05) gyroz = 0.00;            // 瞬間ゼロドリフト除去
agz += gyroz; *Yaw = agz;                        // ★絶対基準なし＝時間で漂う(ドリフト)
```
- **使いどころ**：①直進中の姿勢補正（既存が利用）②**「Yawがα度変わるまで旋回」＝角度ベース旋回**の実装に使える（純正未実装＝我々の改良点）。絶対方位ではないので、短時間の相対角に使うのが安全。

---
関連：経路の作り方は [research-route-and-avoidance.md](research-route-and-avoidance.md) ／ ピン・配線・全体仕様は [machine-reference.md](machine-reference.md)
