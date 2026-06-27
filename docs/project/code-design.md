# コード設計書：自作ルンバ（Web層 ＋ UNO層）

> **なぜ**：実装前に「何を・どこに・どう作るか／依存／フロー」を固め、ハードコーディング・責務肥大・テスト無しを防ぐため。
> **だれのために**：実装する自分。コードを書く時に開く設計の地図。
> **最重要前提**：本システムは **言語も実行環境も違う2層**（Web層／UNO層）からなる。**この2つを混同しないこと**が設計の肝。ロジック仕様は [cleaning-logic-spec.md](cleaning-logic-spec.md)。

---

## 1. システムの2層構造（ここを最初に押さえる）

2つの層は別物で、繋がるのは**シリアルJSONだけ**。

```
┌─ Web層  app/  (TypeScript / ブラウザ) ───────────────────┐
│  頭脳：掃除ロジック・シミュレータ・UI・通信               │
└───────────────┬──────────────────────────────────────────┘
                │  契約＝シリアルJSON（N=3 駆動 / N=21,23,24 センサ）
                │  Web Serial (USB, CH340)
┌───────────────┴──────────────────────────────────────────┐
│  UNO層  arduino/  (C++ / ATmega328P)                      │
│  手足：デバイス駆動・センサ読取・プロトコル解釈            │
└───────────────────────────────────────────────────────────┘
```

### 1.0 リポジトリ配置（`app/` と `arduino/` は兄弟。ネストしない）

別ツール・別実行環境なので、トップレベルで分ける（`arduino/` を `app/` の中に入れない）。

```
elegoo-rover-lab/
├── docs/        # 設計・仕様・リファレンス
├── app/         # Web層（TypeScript / npm・Vite）  → §3
└── arduino/     # UNO層（C++ / Arduino スケッチ）   → §4
```

### 1.1 2層の違い（混ぜない）
| 軸 | Web層 `app/` | UNO層 `arduino/` |
|---|---|---|
| 言語 | TypeScript | C++ |
| 実行環境 | ブラウザ | ATmega328P（8bit, RAM 2KB） |
| ツール | Vite / Vitest / npm | Arduino IDE |
| フォルダ | **自由にネスト可** | **平置き1スケッチ**（`.ino`＝フォルダ名、直下の `.cpp/.h` のみコンパイル） |
| デプロイ | 静的配信 or localhost | USB書き込み（flash） |
| テスト | 単体(Vitest)中心 | 実機スモーク中心 |
| 今回の変更量 | **主開発** | **最小（MPU6050 初期化バグ修正のみ。N=24 は不採用）** |

### 1.2 役割分担の原則（＝境界の引き方）
- **UNO層＝手足**：センサ値と“素の”モータ指令を **serial で出し入れするだけ**。判断ロジックは持たない。当初は `N=24` で Yaw を**データ**として返す予定だったが、**ジャイロ非依存のタイマー旋回（turnTicks）へ方針変更したため N=24 は不採用**（→ §4 / 旋回ロジックは [stage4-timed-turn.md](stage4-timed-turn.md)）。
- **Web層＝頭脳**：経路・旋回角・状態遷移などの**判断を全部持つ**。だから純関数として単体テスト＆シムできる。
- → この分け方なら、**ロジックは testable な TS 側に集中**し、**C++ は最小・データ提供のみ**。2層が綺麗に分離する。

---

## 2. 設計原則（適用範囲つき）

| 原則 | 具体策 | 主な適用 |
|---|---|---|
| ハードコーディング排除 | 数値・しきい値は `config.ts` に集約、ロジックは `cfg` を引数で受ける | Web層 |
| コメント | 各ファイル先頭に「単一責務」を1行、公開関数に意図 | 両層 |
| 単一責任（SRP） | 1ファイル1責務・1関数1目的（フォルダ/ファイル/関数/型の4レベル） | Web層に厚く。UNO層は“1クラス1ファイル”が既存で成立 |
| テスト駆動（TDD） | 純粋モジュールはテスト先行、`*.test.ts` 同居 | Web層 |

---

## 3. Web層 `app/` の構成

```
app/
├── README.md / index.html / package.json / tsconfig.json
└── src/
    ├── config.ts             # 全パラメータの集約（ハードコーディングの唯一の置き場）
    ├── types.ts              # Sensors / Command / State などの型（契約）
    ├── domain/
    │   ├── cleaning.ts       # step() 純粋状態機械（判断のみ）
    │   └── cleaning.test.ts
    ├── protocol/
    │   ├── protocol.ts       # Command⇄JSON、レスポンス⇄値（純粋）= 境界のWeb側実装
    │   └── protocol.test.ts
    ├── io/
    │   ├── robot.ts          # RobotIO インターフェース（依存の境界）
    │   ├── serial-robot.ts   # 実機実装：transport＋protocol
    │   └── transport.ts      # Web Serial 入出力（副作用の隔離）
    ├── sim/
    │   ├── model.ts          # 2D姿勢・壁・レイキャスト（純粋）
    │   ├── model.test.ts
    │   └── sim-robot.ts      # RobotIO のシム実装
    ├── runner.ts             # 制御ループ：read→step→send
    └── ui.ts                 # DOM・描画
```

### 各ファイルの責務
| ファイル | 単一責務 | 純粋? | テスト |
|---|---|---|---|
| `config.ts` | 調整値の集約 | ✓ | — |
| `types.ts` | 型＝契約 | ✓ | — |
| `domain/cleaning.ts` | センサ→次の指令を**決めるだけ** | ✓ | ✓ |
| `protocol/protocol.ts` | 指令⇄JSON文字列の**変換だけ** | ✓ | ✓ |
| `io/robot.ts` | `RobotIO`（read/send）の**契約だけ** | ✓ | — |
| `io/transport.ts` | Web Serial の**送受信だけ**（副作用を1点に隔離） | ✗ | 手動 |
| `io/serial-robot.ts` | transport＋protocol を束ね RobotIO を実装 | ✗ | 手動 |
| `sim/model.ts` | 物理モデル（前進/旋回/レイキャスト）**だけ** | ✓ | ✓ |
| `sim/sim-robot.ts` | model を RobotIO として見せる | ✓ | ✓ |
| `runner.ts` | tick を回し read→step→send を**繋ぐだけ** | ✗ | 手動 |
| `ui.ts` | DOM/描画**だけ**（ロジックを持たない） | ✗ | 手動 |

### 依存関係（依存逆転）
brain（`cleaning`/`runner`）は具体(serial/sim)でなく **`RobotIO` インターフェース**に依存 → 実機なしでシム検証、同じ brain を実機へ。

```
   ui.ts ──▶ runner.ts ──▶ cleaning.ts(純) ──▶ config.ts(純), types.ts
                  │ （interfaceに依存）
                  ▼
               io/robot.ts «RobotIO»
                  ▲                ▲
        serial-robot.ts        sim-robot.ts
          │        │               │
     transport.ts protocol.ts   sim/model.ts(純)
     (Web Serial) (純)
```
純粋・無依存の核：`cleaning` / `protocol` / `sim/model` / `config` / `types`（外を知らない＝テスト容易）。循環なし。副作用は `transport`/`ui` の端に隔離。

---

## 4. UNO層 `arduino/` の構成

**制約**：ビルド単位は**完全な1スケッチ（平置き）**。1ファイルや差分だけでは不可（[Arduino制約は §1.1]）。よって**純正スケッチ一式をコピー**して「クローンして即焼ける」状態にする。

```
arduino/
└── SmartRobotCarV4.0_DIY/                # 純正一式のコピー(実機に焼いたもの)
    ├── SmartRobotCarV4.0_DIY.ino         # ★フォルダ名と一致（.ino をリネーム）
    ├── ApplicationFunctionSet_xxx0.cpp   # ← 純正のまま（N=24 は入れていない）
    ├── ApplicationFunctionSet_xxx0.h
    ├── DeviceDriverSet_xxx0.cpp / .h
    ├── MPU6050_getdata.cpp / .h          # ★ここだけ修正（初期化バグ。下記）
    ├── MPU6050.* / I2Cdev.* / IRremote.* / ArduinoJson-v6.11.1.h   # 純正同梱の依存（無いとビルド不可）
    └── CHANGES.md                         # 純正からの差分（=MPU6050修正だけ）を人間用に記録
    （FastLED / NewPing / pitches / Servo は Arduino IDE にライブラリとしてインストール＝repo には同梱しない）
```

- **唯一の変更点**：`MPU6050_getdata.cpp` の `MPU6050_dveInit()`。純正は `uint8_t cout;` を**未初期化**のまま
  `do/while` のリトライ脱出に使っており、ジャイロが `chip_id 0` を返す個体だと `setup()` が永久に戻らず
  `loop()` が走らない＝**全コマンドに無反応**になっていた。これを**有界 `for` ループ**へ直し、gyro 未検出でも
  必ず `loop()` へ進むようにした（詳細は `SmartRobotCarV4.0_DIY/CHANGES.md`）。本体ロジックは無変更＝“手足”原則を守る。
- **N=24 は不採用**：当初は `case 24` で Yaw を返す計画だったが、旋回を**タイマー方式（turnTicks）**に切り替えたため不要。
  `ApplicationFunctionSet_xxx0.cpp` は**純正そのまま**。
- ライブラリ zip（FastLED/NewPing/pitches/IRremote）は**バイナリなので repo に入れない**。ELEGOO 同梱物から IDE に導入する（手順は `CHANGES.md`）。
- サブフォルダは原則コンパイル対象外（例外は `src/` のみ再帰）。**純正流儀に合わせ平置きで統一**。
- SRP：UNO 側は既に“1クラス1ファイル”（Motor/Ultrasonic/Servo/IMU…）。制約上、深いネストはしない。

---

## 5. 境界の契約：シリアルJSON（唯一の結合点）

2層はコードを共有できない（言語が違う）。だから**プロトコルを1箇所で文書化し、各層が自分の半分を実装**する（ドリフト防止）。
正本＝[machine-reference §9](../reference/machine-reference.md)。Web側は `protocol.ts`、UNO側は `SerialPortDataAnalysis` が実装。

| 向き | N | 意味 | 形（例） |
|---|---|---|---|
| Web→UNO | 3 | 駆動（前進/その場旋回） | `{"H":1,"N":3,"D1":,"D2":}` |
| UNO→Web | 21 | 前方距離（エコー無しは `0`＝範囲外） | `{H_<cm>}` |
| UNO→Web | 23 | 離地（**真偽が反転**：接地→`_true`/離地→`_false`） | `{H_true/false}` |
| ~~UNO→Web~~ | ~~24~~ | ~~Yaw~~ → **不採用**（タイマー旋回に変更）。純正firmwareに `case 24` は無い。`protocol.ts` 側に受け皿だけ残存だが実機は返さず `serial-robot` で `catch→0` | — |
| ~~UNO→Web~~ | ~~25~~ | ~~電圧~~ → **取得不可**。純正のどのシリアルコマンドもバッテリ電圧を返さない（machine-reference で確認済み） | — |

---

## 6. システムフロー（同じ brain・IOだけ差し替え）

**シムモード（実機不要）**
```
runner.tick(): sim-robot.read() → cleaning.step() → sim-robot.send()（modelの姿勢更新）→ ui描画
```
**実機モード（Web Serial）**
```
connect → transport.open()
runner.tick(): serial-robot.read()  // N=21距離 / N=23離地（yaw は使わない＝旋回はタイマー）
            → cleaning.step()
            → serial-robot.send()    // N=3 前進/左旋回
```
`cleaning.step()` と `runner` は**両モード共通**。`RobotIO` の実装差し替えだけ。

---

## 6.1 実機モードの可視化（テレメトリ ＋ カメラ）

> **なぜここに書くか**：2Dマップは本質的に「シム（推定）」。実機には自己位置(x,y)が無い（エンコーダ無し）ので、実機で“本物”として見せられるものを切り分けて定義しておく。**記録のみ・実装は後。**

- **2Dマップ表示はシム専用**（実機では真の位置を描けない＝推定にしかならない）。開発・デモ用に維持する。
- **実機モードのWeb画面** ＝ 次の独立した部品の組み合わせ：

| 部品 | データ源 | チャネル | 本物? | 状態 |
|---|---|---|---|---|
| テレメトリパネル ① | 距離(N=21)/離地(N=23) ※yaw/電圧は不採用・取得不可 | Web Serial（USB・既存経路） | ✅ 実測 | UI拡張で対応 |
| カメラパネル ③（任意） | ESP32-CAM の MJPEG | WiFi（`<img src>`・別系統） | ✅ 実映像 | 任意・要スパイク |
| 2Dマップ | model の pose | シムのみ | ⚠ 推定 | 済 |

### onTick の拡張（テレメトリ供給のため）
`runner` のコールバックを「状態だけ」から「センサ・指令も渡す」形に広げる。UIが実測値を描けるようにするため。

```ts
// 変更前
onTick?: (state: State) => void
// 変更後
onTick?: (state: State, sensors: Sensors, cmd: Command) => void
```

brain（`cleaning`）は無変更。`runner` が read した `sensors` と `step` が返した `cmd` をそのまま渡すだけ（副作用なし・依存は増えない）。

### カメラは独立チャネル（結合しない）
- カメラデータは **UNO/Serial 経路には来ない**。ESP32-CAM が WiFi で配信し、ページは `<img>` で埋め込むだけ。`protocol.ts` / `serial-robot.ts` とは無関係。
- ハード前提（USB制御 と WiFi映像 の同時利用、ESP32↔UNO の UART 競合）は**実機で要確認**。ダメなら「カメラは別タブ表示」にフォールバック。

---

## 7. テスト戦略（層別）

- **Web層**：純粋(`cleaning`/`protocol`/`sim/model`)は **Vitest 先行**。副作用(`transport`/`ui`/`runner`)は手動/スモーク。
- **UNO層**：**実機スモークのみ**（reflash 後に `chip_id` ループが止まり N=3/N=21/N=23 が応答するかをシリアルモニタで確認）。単体テストはコスト過大なのでやらない。
- シムはロジックの破綻検出用。**カバー率（何%拭けるか）は保証しない**（spec §5）。

---

## 8. 実装順序（各段で commit）

1. `config.ts` / `types.ts` → `domain/cleaning.ts` ＋ **テスト**（実機なしで完結）
2. `sim/model.ts` ＋テスト → `sim-robot.ts` → `runner.ts` → `ui.ts`（**シム上で掃除が動く**）
3. `protocol.ts` ＋テスト → `transport.ts` → `serial-robot.ts`（**実機接続・手動操作**）
4. brain を実機 IO で（自走掃除）
5. `arduino/SmartRobotCarV4.0_DIY` を用意（純正コピー＋MPU6050初期化バグ修正）。旋回はタイマー方式にしたため **N=24 は不要**。

---

## 9. 現状 / 次の一手
- ✅ Web層 実装＆テスト済み：段階1〜4（`config`/`types`/`cleaning`/`sim`/`runner`/`protocol`/`serial-robot`/`ui`）。自走（壁検知＋タイマー旋回）＋緊急停止まで動作。
- ✅ `arduino/SmartRobotCarV4.0_DIY/`：純正コピー＋**MPU6050初期化バグ修正**を配置済み（N=24 は不採用）。
- ✅ ワイヤレス：`tools/ws-bridge.mjs`（WS↔ESP32 TCP 中継）＋ `io/ws-transport.ts` ＋ `session.ts`（多重接続ガード `RobotSession`）。カメラは `<img>` で MJPEG 表示。
- ⬜ 未着手（記録のみ）：実機モードUI＝テレメトリパネル①（`onTick` 拡張で距離/離地を表示）。
- 次：本番デモ（macOS）での通し確認。

---
関連：[cleaning-logic-spec.md](cleaning-logic-spec.md) ／ [research-route-and-avoidance.md](../reference/research-route-and-avoidance.md) ／ [code-reference-classes.md](../reference/code-reference-classes.md) ／ [machine-reference.md](../reference/machine-reference.md) ／ 開発ルール [rules.md](../rules.md)
