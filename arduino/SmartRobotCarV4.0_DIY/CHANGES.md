# SmartRobotCarV4.0_DIY — 純正からの差分

ELEGOO 純正ファーム `SmartRobotCarV4.0_V1_20220303`（08 DIY and Program on APP 同梱）の
**コピー**です。フォルダ名・`.ino` 名を Arduino の必須ルール（フォルダ名＝スケッチ名）に合わせて
`SmartRobotCarV4.0_DIY` に変更しています。

## コピー元
```
~/Downloads/ELEGOO Smart Robot Car Kit V4.0 2023.02.01/
  03 Tutorial & Code/
  08 SmartRobotCarV4.0_DIY and Program on APP/
  SmartRobotCarV4.0_V1_20220303/
```
※ このコピー元こそ、実機 UNO に実際に焼いたスケッチ。

## 純正からの差分（＝唯一の変更点）
**`MPU6050_getdata.cpp` の `MPU6050_dveInit()` の初期化バグ修正だけ。**

- 症状: 純正は `uint8_t cout;` を**未初期化**のまま `do/while` でリトライ判定に使っていた。
  ジャイロが `chip_id 0` を返し続ける個体だと「10回で諦めて抜ける」脱出が不定動作になり、
  `setup()` が初期化ループから**永久に戻らず `loop()` が一度も走らない**＝シリアルの
  どのコマンド（N=3 など）にも無反応、というハングを起こしていた。
- 修正: `for (uint8_t cout = 0; cout < 10; cout++)` の**有界ループ**に置換。
  ジャイロを検出できたら `initialize()` して成功、検出できなくても**10回で必ず抜けて**
  `loop()` へ進む（このプロジェクトは yaw を使わない＝タイマー旋回なので gyro 無しでも可）。

差分の現物は `MPU6050_getdata.cpp` を純正 `.orig` と比較すれば確認できる
（コピー元フォルダに `MPU6050_getdata.cpp.orig` を保存済み）。

## やっていないこと（重要）
- **N=24（Yaw 返却）は追加していない。** 設計ドキュメントの構成図には
  「ApplicationFunctionSet_xxx0.cpp に N=24 を追加」とコメントがあるが、途中で
  **ジャイロ非依存のタイマー旋回（turnTicks）**へ方針変更したため N=24 は不要になり、
  未実装のまま。よって `ApplicationFunctionSet_xxx0.cpp` は**純正そのまま（無変更）**。

## ビルド方法（Arduino IDE）
1. このフォルダ（`SmartRobotCarV4.0_DIY/`）を Arduino IDE で開く（`.ino` をダブルクリック）。
2. 依存ライブラリを IDE にインストール（このリポジトリには**同梱しない**＝バイナリzipを git に入れないため）。
   ELEGOO 同梱の zip を「スケッチ > ライブラリをインクルード > .ZIP形式のライブラリをインストール」で入れる:
   ```
   ~/Downloads/ELEGOO Smart Robot Car Kit V4.0 2023.02.01/
     03 Tutorial & Code/08 SmartRobotCarV4.0_DIY and Program on APP/
     SmartRobotCarV4.0_V1_20220303/addLibrary/
       ├── FastLED-master.zip   ← 必須(RGB LED)
       ├── NewPing.zip          ← 必須(超音波)
       ├── pitches.zip          ← 必須(ブザー音階)
       └── IRremote.zip         ← 入れなくて可(下記)
   ```
   - `Servo` は IDE 標準（インストール不要）。
   - `IRremote` は**スケッチ内に同梱済み**（`IRremote.cpp/.h/IRremoteInt.h`）。IDE 側にも入れると
     重複コンパイル警告が出るので、**どちらか一方**に寄せる（基本は IDE 側を入れない）。
3. ボード「Arduino Uno」、正しいシリアルポートを選んで Upload。

## 含めていないファイル（純正にはあるが repo には入れないもの）
- `addLibrary/*.zip`（IDE 用ライブラリ＝バイナリ。上記 ELEGOO 同梱から入れる）
- `*.ino.standard.hex`（純正のコンパイル済みバイナリ）
- `.vscode/`, `Description.txt`, `MPU6050_getdata.cpp.orig`（コピー元フォルダに保管済み）
