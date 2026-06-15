# 調査：経路（走り方）と障害物回避 — 既存コードからの読み解き

> **なぜこの文書があるか**：エンコーダの無いこのロボットで「経路（走り方）」をどう作れるかを、推測ではなく**既存ファーム／デモの実装**から確かめるため。
> **なんのために**：我々の掃除挙動（自走ロジック）と Web シミュレータを設計する土台にする。あとで迷わないよう、判断の一次ソース＝実コードと出典行を残す。
> **だれのために**：実装する自分（と、後で読み返す自分）。仕様を思い出す/検証する時に開く。

出典タグ（特記なき限り**メインプログラム**配下）。ルート＝
`02 Manual & Main Code & APP/02 Main Program   (Arduino UNO)/TB6612 & MPU6050/SmartRobotCarV4.0_V1_20230201/`

| タグ | ファイル |
|---|---|
| `[ino]` | `SmartRobotCarV4.0_V1_20230201.ino` |
| `[App]` | `ApplicationFunctionSet_xxx0.cpp` |
| `[App.h]` | `ApplicationFunctionSet_xxx0.h` |
| `[Dev]` | `DeviceDriverSet_xxx0.cpp` |
| `[MPU]` | `MPU6050_getdata.cpp` |
| `[Obs2]` | `03 Tutorial & Code/05 SmartRobotCarV4.0_Obstacle/TB6612/Demo2/ApplicationFunctionSet_xxx0.cpp`（自走のみの簡易版） |

---

## 1. 全体像：このロボットの「動き方」

`loop()` は毎周回ですべてのモード／コマンドのハンドラを呼び、**現在の `Functional_Mode` に一致するものだけが実際に動く**協調的ステートマシン。`wdt_enable(WDTO_2S)` で2秒無応答ならリセット。[ino:19-42]

```cpp
void loop() {
  wdt_reset();
  Application_FunctionSet.ApplicationFunctionSet_SensorDataUpdate();
  Application_FunctionSet.ApplicationFunctionSet_KeyCommand();
  Application_FunctionSet.ApplicationFunctionSet_RGB();
  Application_FunctionSet.ApplicationFunctionSet_Follow();
  Application_FunctionSet.ApplicationFunctionSet_Obstacle();   // ← 障害物回避（=掃除の素）
  Application_FunctionSet.ApplicationFunctionSet_Tracking();   // ← ライン追従
  Application_FunctionSet.ApplicationFunctionSet_Rocker();
  Application_FunctionSet.ApplicationFunctionSet_Standby();
  Application_FunctionSet.ApplicationFunctionSet_IRrecv();
  Application_FunctionSet.ApplicationFunctionSet_SerialPortDataAnalysis();  // ← 外部(シリアル/JSON)指令の受信
  Application_FunctionSet.CMD_ServoControl_xxx0();             // ← 受信した指令の実行群
  Application_FunctionSet.CMD_MotorControl_xxx0();
  /* ...CMD_* が続く... */
}
```

**示唆（なぜ我々に効くか）**：モードは排他。「掃除」は `Obstacle` モードに相当する。外部からは `SerialPortDataAnalysis` 経由で `N=101` でモード切替、`N=3/N=4` で直接駆動できる。**TS側にブレインを置くなら「モードを使わず `N=3/N=4` を直接送る」形が素直**（純正の状態機械と競合しない）。

---

## 2. 「経路」を作る3つの素材

### A. 障害物回避＝壁を検知して動く（＝掃除の出発点）[App:642-714]

```cpp
void ApplicationFunctionSet::ApplicationFunctionSet_Obstacle(void) {
  ...
  AppULTRASONIC.DeviceDriverSet_ULTRASONIC_Get(&get_Distance);
  if (function_xxx(get_Distance, 0, 20)) {              // 前方20cm以内に壁
    ApplicationFunctionSet_SmartRobotCarMotionControl(stop_it, 0);
    for (uint8_t i = 1; i < 6; i += 2) {                // サーボを 30°,90°,150° に振る
      AppServo.DeviceDriverSet_Servo_control(30 * i);
      AppULTRASONIC.DeviceDriverSet_ULTRASONIC_Get(&get_Distance);
      if (function_xxx(get_Distance, 0, 20)) {          // その向きも塞がり
        if (5 == i) {                                   // 全方位ダメ → 後退して右へ
          ApplicationFunctionSet_SmartRobotCarMotionControl(Backward, 150); delay_xxx(500);
          ApplicationFunctionSet_SmartRobotCarMotionControl(Right, 150);    delay_xxx(50);
          first_is = true; break;
        }
      } else {                                          // 空いてる向きへ
        switch (i) {
          case 1: ApplicationFunctionSet_SmartRobotCarMotionControl(Right, 150);   break; // 30°=右
          case 3: ApplicationFunctionSet_SmartRobotCarMotionControl(Forward, 150); break; // 90°=前
          case 5: ApplicationFunctionSet_SmartRobotCarMotionControl(Left, 150);    break; // 150°=左
        }
        delay_xxx(50); first_is = true; break;
      }
    }
  } else {                                              // 前方クリア → 前進
    ApplicationFunctionSet_SmartRobotCarMotionControl(Forward, 150);
  }
}
```

- 動き：前方 >20cm は前進(速度150)。≤20cm で停止→サーボを右/前/左に振って測距→**最初に空いた向き（右→前→左の順）へ旋回**。全方位塞がりなら後退500ms＋右旋回。
- しきい値 `20` は `ObstacleDetection = 20`[App.h:77]。
- **使いどころ**：これが「直進→壁→旋回→直進」そのもの。ただし sweep（賢い方向選び）は“ざっくり掃除”には過剰。**前方1点で「閉→決めた向きへ一定旋回」に単純化**すれば十分。

### B. ライントラッキング＝物理的に“予め決めた経路” [App:557-637]

```cpp
if (function_xxx(TrackingData_M, ...)) ApplicationFunctionSet_SmartRobotCarMotionControl(Forward, 100); // 中央が線→前進
else if (function_xxx(TrackingData_R, ...)) ApplicationFunctionSet_SmartRobotCarMotionControl(Right, 100); // 右が線→右
else if (function_xxx(TrackingData_L, ...)) ApplicationFunctionSet_SmartRobotCarMotionControl(Left, 100);  // 左が線→左
else { /* 線を見失う→時間ベースで左右に首振りして再捕捉(Blind Detection) */ }
```

- 3つのIRで黒線を追従。見失うと時間ベースの探索。
- **使いどころ**：エンコーダ無しでも**literal に“決めた経路”を作れる唯一の手**＝床に黒テープを貼ればその通り走る。「経路を予め決めておく」を文字通りやるならコレ。掃除範囲＝テープのレイアウトで定義できる**有力な代替案**。

### C. 直進＋旋回プリミティブ [App:205-318]

`MotionControl(direction, speed)` が前後左右・カーブ・停止を提供。前進/後退は次節のジャイロ直進制御を通る。Left/Right は左右輪を逆回転させ**その場旋回**。

```cpp
case Left:  // 左旋回：A(右)前転・B(左)逆転
  AppMotor.DeviceDriverSet_Motor_control(direction_just, speed, direction_back, speed, control_enable); break;
case Right: // 右旋回：A(右)逆転・B(左)前転
  AppMotor.DeviceDriverSet_Motor_control(direction_back, speed, direction_just, speed, control_enable); break;
```

---

## 3. 自走の心臓：直進はジャイロ補正・旋回は時間ベース（重要な発見）

### 直進＝ジャイロ Yaw で P 的に補正 [App:151-199]

```cpp
// 進入時の Yaw を yaw_So に記録し、左右に速度差をつけてズレを戻す
int R = (Yaw - yaw_So) * Kp + speed;   // 上限/下限[10,UpperLimit]でクランプ
int L = (yaw_So - Yaw) * Kp + speed;
if (direction == Forward)
  AppMotor.DeviceDriverSet_Motor_control(direction_just, R, direction_just, L, control_enable);
```

`Kp`/`UpperLimit` はモード別[App:213-239]（Obstacle時 `Kp=2,上限180`、Rocker時 `Kp=10,上限255`）。
**示唆**：直進セグメントは“そこそこまっすぐ”引ける土台がすでにある（外乱・モータ個体差を Yaw で吸収）。

### 旋回＝角度ではなく時間 [App:676-699]

旋回は `MotionControl(Right,150)` の直後に `delay_xxx(50)`（後退は `delay_xxx(500)`）。**角度フィードバックが無い**＝何度曲がるかは時間任せで不正確。
**改善余地（我々の付加価値）**：Yaw は取れる[MPU:69-83]。「**Yaw が約 N 度変わるまで回す**」角度ベース旋回にすれば往復走行がきれいになる。純正は未実装。

---

## 4. センサの読み方としきい値

- **超音波**[Dev:278-298]：`pulseIn(ECHO,HIGH)/58`、150cm にクランプ。
- **ライン(ITR20001)**[Dev:118-129]：`analogRead` の生値（0–1023）。
- **離地判定**[App:127-141]：3センサ全部が `>950` で「浮いている」と判定（＝床から離れたら停止する安全機構）。
- しきい値[App.h:76-86]：`ObstacleDetection=20` / `VoltageDetection=7.00` / ライン `S=250,E=850,V=950`。

---

## 5. 我々の掃除挙動への落とし込み（結論）

- **ベース＝A の単純化版**：前進（ジャイロ直進）→ 前方 < しきい値 → 旋回 → 繰り返し。sweep は省略可。
- 旋回を **Yaw 角度ベース**にすると質が上がる（往復/ジグザグがきれいに）。
- “厳密に決めた経路”をやりたいなら **B（ライン追従＝黒テープ）** も選択肢。
- いずれも **「(距離 or ライン) → 指令」の純関数**に落ちる ＝ TS 移植＆シムが容易（先のレビュー方針と一致）。

## 6. 制約（再確認）

位置・移動距離の積算手段は無い。Yaw のみで、しかも積分ドリフトする[MPU:69-83]。**地図上の自己位置は不可**。「経路」は “動きの決まり” か “物理マーカー（線）” に限られる。

---
関連：[machine-reference.md](machine-reference.md) ／ クラス詳細は [code-reference-classes.md](code-reference-classes.md)
