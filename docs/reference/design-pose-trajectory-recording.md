# 設計書：自己位置推定・軌跡ログ・カメラ録画

> **なぜこの文書があるか**：3つの新要望——①ロボットが自分の位置を分かっていない（自己位置推定）／②走った軌跡をログとして残したい／③ライブ表示しているカメラ映像を保存したい——を、**今のハード（ELEGOO V4.0 + UNO + ESP32-CAM、エンコーダ無し）と既存アーキテクチャ（頭脳=ブラウザ / UNO=手足 / Node中継）を壊さずに**実現する方法を、方式比較つきで設計し、着手順を決めるため。
> **位置づけ**：実装設計（design）。具体の段階化は `stageN-*.md` に落とす。
> **設計の鉄則（既存方針の踏襲）**：判断・推定はすべて Web層 `app/` の**純関数**に置く／UNO は手足のまま（変更は最小）／副作用（保存・録画・描画）は端へ隔離／`sim/model.ts` を推定器として**流用**／**推定は「推定」と正直に明示**する。
> 参照：[code-design.md](code-design.md) §6.1 ／ [vision-autonomy-and-cleaning-roadmap.md](../reference/vision-autonomy-and-cleaning-roadmap.md) §3.2 ／ [current-build-spec.md](../reference/current-build-spec.md) §4,§5,§9 ／ [machine-reference.md](../reference/machine-reference.md) §6.3,§9 ／ [stage5-wireless-camera.md](stage5-wireless-camera.md)

---

## 0. 一言でいうと

- **自己位置推定**：エンコーダが無いので「真値」は本質的に出せない。**`sim/model.ts` を推定器に流用した推測航法（dead reckoning）＋ IMU の yaw** で「推定の現在地」を出す。**真値が欲しいときだけ俯瞰カメラ＋ArUcoマーカー**を足す（ロボット改造ゼロ）。画面では必ず「推定」と明示。
- **軌跡ログ**：`runner` の既存 `onTick(state, sensors, cmd)` フックに**ロガーを1個ぶら下げる**だけ。毎tickの「生データ（指令・センサ・経過時間）＋推定姿勢」をメモリに溜め、**NDJSON/CSV でダウンロード**（長時間はNode中継へ自動保存）。生データを残すので**後から良い校正値で再推定**できる。
- **カメラ録画**：MJPEG を `<img>` で見ているだけの今に、**Node の録画プロキシ（`tools/cam-proxy.mjs`）＋ ffmpeg** を足して mp4 保存。プロキシ経由にすると **(a) ESP32への上流接続が1本で済む (b) CORS汚染が解けてブラウザ録画も可能 (c) ライブ表示は維持**、の3つを同時に取れる。ffmpeg は導入済み（`/opt/homebrew/bin/ffmpeg`）。

労力対効果：**軌跡ログ（即・低コスト・依存ゼロ）→ 推測航法の推定（中・校正が要る）→ カメラ録画（中・ffmpeg/プロキシ）→ 俯瞰カメラ真値（高・任意）**。

---

## 1. 3つの要望と「現実の制約」

| 要望 | 何が欲しいか | 最大の制約 | 現実解 |
|---|---|---|---|
| ① 自己位置推定 | いまロボットがどこに居るか (x, y, 向き) | **車輪エンコーダが無い**＝真の移動量を測れない | 指令＋時間＋IMU yaw からの**推測航法（推定）**。真値は俯瞰カメラで別取り |
| ② 軌跡ログ | どこをどう走ったかの記録 | ①が推定なので軌跡も推定。だが**記録自体は確実にできる** | `onTick` で生データ＋推定姿勢を蓄積→ファイル化 |
| ③ カメラ録画 | ライブ表示中の映像を保存 | **MJPEG over `<img>` は素直に録画できない**（CORS汚染／ESP32同時接続数） | Nodeプロキシで中継・録画（ffmpeg→mp4）。ブラウザ録画はフォールバック |

**逆風（共通）**：エンコーダ無し → 位置は「推定」。**追い風（共通）**：頭脳がブラウザ側にあり、`onTick` という綺麗な観測フックが既にある（[code-design §6.1](code-design.md)）。`protocol.ts` には既に `encodeQueryYaw`/`decodeYaw`（N=24）の**受け皿だけ実装済み**（firmwareは未実装・serial-robotは未問い合わせ）。

---

## 2. 全体アーキテクチャ（3機能をどう載せるか）

3機能は**1つの「セッション」**で束ねる。「開始」を押すと `sessionId` と基準時刻 `t0` が決まり、**軌跡ログと録画が同じ `t0` を共有**する。これで後から「地図上の軌跡」と「動画」を時刻で突き合わせできる。

```
┌─ Web層 app/（頭脳・純関数中心） ─────────────────────────────────────┐
│                                                                       │
│  runner.tick(): read → step → send → onTick(state, sensors, cmd)      │
│                                            │                          │
│                 ┌──────────────────────────┼───────────────────┐     │
│                 ▼                          ▼                    ▼     │
│        localization/estimator   logging/trajectory        ui.ts       │
│        （推測航法＝sim/model流用）  （生＋推定を蓄積）      （地図＋軌跡トレイル描画）│
│                 │                          │                          │
│                 └─ pose(x,y,yaw,推定) ─────┴─ download(NDJSON/CSV)     │
│                                            └─（任意）WSでNodeへ自動保存 │
│                                                                       │
│   <img src="http://localhost:8082/stream">  ← 録画プロキシ経由のライブ表示 │
└───────────────────────────────────────────────────────────────────────┘
        │ Web Serial(USB) / WS中継(WiFi)            │ HTTP（別系統）
        ▼                                            ▼
   [ESP32 → UNO]（駆動・距離・離地、任意でyaw）   [tools/cam-proxy.mjs]
                                                  ├─ 上流: ESP32 :81/stream を1本だけ取得
                                                  ├─ 下流: localhost:8082/stream で再配信(CORS可)
                                                  └─ 録画: ffmpeg → recordings/<sessionId>.mp4
        （任意・真値）[俯瞰webカメラ + ArUco] ──→ ground-truth pose
```

**設計の肝**：3機能とも `runner`/`cleaning`/`protocol` の**コア（純関数）は無変更**。`onTick` への購読と、Node側ツール追加で載る。UNO は ①の yaw を使う場合のみ最小変更（後述・任意）。

---

## 3. 機能①：自己位置推定

### 3.1 方式の比較（◎推奨 / ○可 / △限定 / ✕非現実）

| 方式 | 仕組み | 精度 | 改造 | 実装量 | 評価 |
|---|---|---|---|---|---|
| **A. 推測航法（指令のみ）** | 出した指令(forward/turn)＋経過時間×校正値で姿勢を積分。`sim/model.ts` の `advance()` をそのまま流用 | 低（向きの誤差が累積→位置も崩れる） | ゼロ | 小 | ○ まず動かす最短 |
| **B. 推測航法 ＋ IMU yaw** | 並進は指令、**向きは MPU6050 の yaw** で補正。向きの誤差を断つ | 中（数分・小部屋なら見られる） | firmware最小（N=24再有効化・任意） | 小〜中 | **◎ 主軸（実機の既定）** |
| **C. 俯瞰カメラ ＋ ArUcoマーカー** | 天井/三脚から部屋を真上撮影、車体上面のマーカーを追跡→**真の (x,y,θ)** | 高（真値・ground truth） | ロボットは紙マーカー貼るだけ | 中 | ◎ 校正・真値・デモ用（任意・別系統） |
| D. 視覚オドメトリ（車載カメラ） | ESP32-CAM の前方映像からフレーム間の動きを推定 | 低〜中（低fps・ブレ・奥行き無で不安定） | ゼロ | 大 | △ 将来研究。主軸にしない |
| E. 超音波で壁拘束補正 | 壁までの距離で位置をたまに補正 | 低（部分的） | ゼロ | 中 | △ Bの上に乗せる将来オプション |

> **なぜ B が主軸か**：推測航法で真っ先に壊れるのは**向き（heading）**で、向きがずれると並進がそのまま位置誤差になって雪だるま式に増える。MPU6050 は向き（yaw）を出せる（[machine-reference §6.3](../reference/machine-reference.md)）ので、**一番弱い軸だけをセンサで押さえる**のが費用対効果が高い。旋回の「制御」はタイマー方式のまま（[stage4-timed-turn.md](stage4-timed-turn.md)）でよく、yaw は**推定（向きの観測）にだけ**使う——roadmap §3.2 の「旋回で捨てた yaw が推定で復活する」がこれ。

> **なぜ C を別建てで残すか**：A/B はあくまで推定でドリフトする。**「本当はどこを走ったか」を一度でも測ると、A/B の校正値（cm/tick・deg/tick）を正しく合わせられる**し、デモで「推定 vs 真値」を並べると説得力が出る。ロボット改造ゼロ（マーカーを貼るだけ）なのが効く。

**結論**：**実機の既定は B**（A はその縮退＝yaw無しで動く同じコード）。**C は校正・真値が要るときに足す任意の別系統**。D/E は将来。

### 3.2 モジュール設計（Web層・純関数）

`sim/model.ts` の物理を**実機の推定器として再利用**する。新規は薄いラッパ1枚と校正設定だけ。

```
app/src/
├── sim/model.ts            # 既存。advance()/Pose は無変更で流用
└── localization/
    ├── motion-model.ts     # 新規・純：実機校正値(cm/tick, deg/tick)と yaw 対応付け
    ├── estimator.ts        # 新規・純：1tick分 pose を進める推定器（IMU yaw 対応）
    └── estimator.test.ts   # 新規：Vitest
```

**`estimator.ts`（純関数）の契約**：
```ts
// 1tick分、姿勢を進める。yawObs があれば向きはそれで上書き、無ければ指令から積分。
//   - 並進は sim/model の advance() を流用（forward 指令のみ動く）
//   - 旋回は yawObs があれば信用、無ければ advance() の turn 積分に委ねる
//   - dtMs は「実測の経過時間」を渡す（後述：busyガードでtickは伸びるため tickMs ではダメ）
export function stepEstimate(
  pose: Pose,            // 直前の推定姿勢
  cmd: Command,          // 出した指令
  dtMs: number,          // 前tickからの実経過[ms]（Date.now() 差分）
  m: MotionModel,        // 校正値（cm/tick換算・deg/tick換算・yawの符号/原点）
  yawObs?: number,       // IMU yaw[度]（あれば）。無ければ undefined
): Pose
```

**`MotionModel`（校正値・`config.ts` 流儀でハードコーディング集約）**：
| 項目 | 意味 | 求め方 |
|---|---|---|
| `cmPerSecAtDriveSpeed` | `driveSpeed=120` PWM での実速度 [cm/s] | 巻尺＋ストップウォッチで実測（目標20〜30cm/s、[research-roomba-speed-and-motion](../reference/research-roomba-speed-and-motion.md)） |
| `degPerSecAtTurnSpeed` | `turnSpeed=150` PWM での実角速度 [°/s] | 1回転にかかる時間を実測（目標60〜120°/s） |
| `yawSign` / `yawOffsetDeg` | IMU yaw と sim 座標系（CCW+,0=+x）の対応 | 起動時に「初期向き=0」とし符号を実機で確認 |

> **注意（実装の落とし穴）**：`advance()` の `SimConfig.maxDriveCmPerTick/maxTurnDegPerTick` は**シムの公称値**。実機推定では使わず、`MotionModel` の**実測値**から「この dtMs で何cm/何度」を計算して `advance()` に渡す（or 等価な並進・回転を直接適用）。**dtMs は名目 `tickMs=120` ではなく実測経過**を使う——`runner` の `busy` ガードでシリアル往復が遅いとtick周期は伸びるため（[runner.ts:23](../../app/src/runner.ts)）、名目値だと推定が実機より速く進んでしまう。

### 3.3 データフロー（既存フックに乗せる）

`onTick(state, sensors, cmd)` は**すでに sensors と cmd を渡している**（[code-design §6.1](code-design.md) で拡張済み）。ここで推定器を1tick回すだけ。

```ts
// main.ts の onTick（概念。実際は logging とまとめてセッションに束ねる）
let pose = INITIAL_POSE;            // 推定の現在地
let last = Date.now();
const onTick = (state, sensors, cmd) => {
  const now = Date.now(); const dt = now - last; last = now;
  pose = stepEstimate(pose, cmd, dt, motionModel, sensors.yawDeg || undefined);
  draw(ctx, { pose }, simConfig);   // ui.ts を流用して推定姿勢を描画（必ず「推定」表示）
  logger.push({ t: now - t0, dt, cmd, sensors, state, pose });  // ②へ
};
```

**シムと実機で描画・モデルを共有**：`draw()` は `World{pose}` を受けるだけなので、実機の推定 pose をそのまま渡せば**同じ地図描画が再利用**できる（roadmap §3.2）。

### 3.4 yaw の供給経路（UNO側・任意の最小変更）

B を完全に効かせるには yaw が要る。3段階で選べる：

1. **段階0：yaw 無し（=方式A）**。`sensors.yawDeg` は今のまま 0。**firmware変更ゼロ**で推測航法が動く（ドリフトは大きめ）。まずこれで配線を通す。
2. **段階1：UNO に N=24 を足す（推奨・小改修）**。firmware の `SerialPortDataAnalysis` に `case 24:` を1つ追加し、内部で計算済みの yaw を `{H_<yaw>}` で返すだけ。Web側は**受け皿が既にある**（`encodeQueryYaw`/`decodeYaw`）。`serial-robot.ts` の `read()` で yaw を問い合わせるよう1行戻す。
   - **コスト対策（重要）**：yaw を毎tick問い合わせると往復が増え、特にWiFiで体感遅延になる（N=24 を当初捨てた理由＝[serial-robot.ts:23](../../app/src/io/serial-robot.ts)）。なので**毎tickではなく旋回の前後（phase が drive↔turn を跨ぐtick）だけ問い合わせる**。間のtickは指令から積分。これで「向きの基準点」をセンサで打ち直しつつ、往復コストを最小化する。
3. **段階2：実測校正**。yaw あり/なしで実機を走らせ、俯瞰カメラ（C）か実測で `MotionModel` を合わせ込む。

> **手足原則は維持**：UNO は「yaw という**データ**を返すだけ」。判断（どう曲がるか）は持たせない。N=24 は当初 [code-design §5](code-design.md) で「タイマー旋回にしたから不採用」としたが、**今回は“旋回制御のため”ではなく“軌跡推定のため”に復活**させる——役割が違う。`CHANGES.md` にこの差分（純正からの追加 case）を記録する。

---

## 4. 機能②：軌跡ログ

### 4.1 何を記録するか（生データ＋推定をセットで）

**生の入力（指令・センサ・経過時間）と、そこから出した推定姿勢の両方**を残す。生を残す理由：**後から良い校正値で再推定（リプレイ）できる**＝校正前に取ったログも無駄にならない。

**スキーマ（NDJSON：1行目がヘッダ、以降1tick1行）**：
```jsonc
// 1行目：セッションヘッダ（自己記述的に・再現に必要な文脈を全部入れる）
{"type":"header","v":1,"sessionId":"2026-06-28T12-00-00","startedAtIso":"...",
 "source":"wifi",                         // sim | usb | wifi
 "config":{"wallCm":20,"turnTicks":4,...},// config.ts のスナップショット
 "motionModel":{"cmPerSec":..,"degPerSec":..,"yawSign":..,"yawOffsetDeg":..},
 "pose0":{"x":20,"y":75,"yawDeg":0},      // 推定の初期姿勢
 "camera":{"recording":true,"file":"recordings/2026-...-mp4"}} // ③と紐付け
// 2行目以降：tickサンプル
{"type":"tick","t":120,"dt":133,"cmd":{"kind":"forward","speed":120},
 "dist":48,"lifted":false,"yawObs":null,"phase":"drive","turnLeft":0,
 "pose":{"x":22.6,"y":75,"yawDeg":0.0}}   // pose は推定（明示）
```

- `t` はセッション基準 `t0` からの相対ms（**③の動画と同じ時刻軸**）。`dt` は推定に使った実経過。
- `yawObs` は IMU 由来（無ければ null）。`pose` は推定であることをヘッダ/UIで明示。
- **CSV版**も同じ列を1行ずつ吐く（表計算で開きたい用）。NDJSON が一次、CSV は派生。

### 4.2 保存方法の比較

| 方法 | 仕組み | 持続性 | 依存 | 評価 |
|---|---|---|---|---|
| **A. ダウンロード（Blob）** | メモリに溜め、停止時に `Blob`＋`<a download>` で NDJSON/CSV 保存 | 手動・1回 | ゼロ（純ブラウザ） | **◎ 既定**。最短・依存なし |
| B. Node中継へ自動保存 | `onTick` で WS（既存中継 or 専用）へ送り、Nodeが追記書き | 自動・長時間OK | Node 1プロセス | ○ 長時間・取りこぼし防止に |
| C. IndexedDB | ブラウザ内DBに蓄積、後でエクスポート | リロード跨ぎOK | ゼロ | ○ 中間。長時間でメモリを食わせたくない時 |

**結論**：**まず A（ダウンロード）**。`onTick` で配列に push し、停止時にシリアライズして落とすだけ＝即・依存ゼロ。**長時間運用や取りこぼしが怖くなったら B**（録画プロキシ `cam-proxy.mjs` に保存口を相乗りさせれば1プロセスで済む）。メモリ肥大が気になれば C。

### 4.3 モジュール設計（純粋部分はテスト可能に）

```
app/src/logging/
├── trajectory.ts        # 新規：push(sample) / toNDJSON() / toCSV()（蓄積と整形＝ほぼ純）
├── trajectory.test.ts   # 新規：整形の単体テスト
└── download.ts          # 新規：Blob生成→ダウンロード（副作用＝端に隔離）
```
- 整形（`toNDJSON`/`toCSV`）は純関数＝Vitest。実際のファイル保存（Blob/`<a>`）だけ副作用として `download.ts` に隔離（`ui.ts`/`transport.ts` と同じ「端に副作用」方針）。

### 4.4 軌跡の描画（地図に“パンくず”を足す）

今の `ui.ts` の `draw()` は**現在地の点と矢印だけ**。軌跡を見せるには**過去 pose のポリライン（トレイル）**を足す。`draw(ctx, world, sc, trail?)` のように任意引数で受け、`trail` があれば線で結ぶ（無ければ現状どおり）。シム・実機・**ログのリプレイ**で同じ描画を共有。

### 4.5 リプレイ（おまけだが強い）

生データ（cmd・dt・yawObs）を残しているので、保存した NDJSON を読み込み→`stepEstimate` を回し直せば**別の校正値で軌跡を引き直せる**。録画 mp4 と `t` を揃えて再生すれば「動画を見ながら地図上の推定軌跡をなぞる」ビューアになる（将来 `replay.ts`）。

---

## 5. 機能③：カメラ録画

### 5.1 何が難しいか（先に制約）

- **MJPEG を `<img>` で見ている**だけ（`http://192.168.4.1:81/stream`、[stage5-wireless-camera §0](stage5-wireless-camera.md)）。`<img>` はそのままでは録画できない。
- **CORS汚染**：別オリジン（192.168.4.1）の映像を `<canvas>` に描くと canvas が "tainted" になり、`captureStream`/`toBlob` がブロックされる（ESP32がCORSヘッダを返せば回避できるが**要確認**）。
- **ESP32 の同時接続**：WROVER-CAM は同時クライアント数・帯域が貧弱。**ブラウザ表示＋録画で stream を二重に引く**と不安定化しうる。
- **画質の上限**：AP越しのMJPEGは低解像度・低fps（実測 ~10〜25fps 程度）。録画品質はこれが上限（正直に）。

### 5.2 方式の比較

| 方式 | 仕組み | 出力 | 上流接続 | CORS | 評価 |
|---|---|---|---|---|---|
| R1. ブラウザ録画 | `<img>`→hidden `<canvas>`に毎フレーム描画→`captureStream()`→`MediaRecorder`→WebM | WebM（DL） | ブラウザが直接（1本） | **汚染リスク**（ESP32のCORS次第） | ○ 依存ゼロ・**テレメトリ焼き込み可**。だが汚染で詰む恐れ |
| R2. ffmpeg 直接 | Nodeで `ffmpeg -i http://192.168.4.1:81/stream -c:v libx264 out.mp4` | mp4 | ffmpegが直接（＝**2本目**） | 無関係 | ○ 最短スパイク。だがブラウザ表示と二重接続 |
| **R3. 録画プロキシ** | `cam-proxy.mjs` が上流を**1本だけ**取得→ `localhost:8082/stream` で再配信＋ffmpegへtee | mp4＋ライブ維持 | プロキシのみ（**1本**） | **解決**（localhost＋CORSヘッダ付与） | **◎ 推奨** |

> **なぜ R3 か**：プロキシを1枚挟むと **(a) ESP32 への上流接続が1本**（同時接続問題が消える）、**(b) ブラウザは `localhost:8082/stream` を見る＝同一扱いで CORS 汚染が解け**、R1のブラウザ録画やCV処理も後でやれる、**(c) ライブ表示は途切れない**、の3つを同時に取れる。既に `ws-bridge.mjs` という Node 中継を受け入れている設計なので**思想的に一貫**（[stage5-wireless-camera §3](stage5-wireless-camera.md)）。ffmpeg は導入済み（`/opt/homebrew/bin/ffmpeg`）。

**結論**：**R3 を主軸**（高品質・堅牢・ライブ維持）。**R2 は最短スパイク**（まず録れるか確認）。**R1 はフォールバック＆「地図/距離/時刻を焼き込んだデモ動画」が欲しいとき**（汚染が解けていれば R3 と併用可）。

### 5.3 録画プロキシの設計（`tools/cam-proxy.mjs` 新規）

```
[ESP32 :81/stream] ──(上流1本)──> cam-proxy.mjs ──┬──> localhost:8082/stream（ブラウザ<img>・CORS可）
   multipart/x-mixed-replace                       └──> ffmpeg stdin ──> recordings/<sessionId>.mp4
                                                        ＋ recordings/<sessionId>.json（開始時刻など）
```

実装方針（~60行・`ws-bridge.mjs` と同じ Node 純正モジュール＋`child_process`）：
1. 上流 `http.get('http://192.168.4.1:81/stream')` を**1接続**だけ張る。`multipart/x-mixed-replace; boundary=...` をパースし、各パートの **JPEGバイト列**を取り出す。
2. **下流**：`http.createServer` で `:8082/stream` を待ち受け、ブラウザには**同じ multipart 形式**で各JPEGを再送（`Access-Control-Allow-Origin: *` を付ける）。複数ブラウザ可。
3. **録画**：取り出したJPEGを **concatして ffmpeg の stdin** に流す。ffmpeg は連結JPEGを mjpeg demuxer で読める：
   ```bash
   ffmpeg -f mjpeg -use_wallclock_as_timestamps 1 -i pipe:0 \
          -c:v libx264 -pix_fmt yuv420p -movflags +faststart recordings/<sessionId>.mp4
   ```
   `-use_wallclock_as_timestamps 1` で**実時間どおりの再生速度**になる（可変fpsのMJPEGでも破綻しない）。
4. **サイドカー**：`recordings/<sessionId>.json` に `{startedAtIso, upstream, note}` を書き、**②の軌跡ログの `t0` と突き合わせ**られるようにする。
5. **制御口（任意）**：`:8082/rec/start?session=...` / `/rec/stop` の小エンドポイントで録画開始/停止。ブラウザの「録画」ボタンから叩く。最小実装は「プロセス起動＝録画開始／Ctrl-C＝終了」でも可。

`tools/package.json` は依存追加不要（Node標準＋ffmpegバイナリ）。`ws-bridge.mjs` と並べて `node cam-proxy.mjs` で起動。

### 5.4 ブラウザ側の変更（最小）

- `index.html`：`<img id="cam">` の `src` を **`http://localhost:8082/stream`**（プロキシ経由）に変える。録画ボタン（任意）を1つ足す。
- `main.ts`：WiFi接続成功時に `cam.src = CAM_URL` していた箇所（[main.ts:86-88](../../app/src/main.ts)）の `CAM_URL` を `config.ts` でプロキシURLに切替（録画しない時は従来の直URLでも可＝設定1つ）。
- **R1（任意）**：プロキシ経由で汚染が解けていれば、`<img>`→`<canvas>`→`MediaRecorder` で「地図・距離・時刻を焼き込んだ」クリップも作れる（デモ映え）。

### 5.5 正直な注意

- **ESP32の帯域・発熱**：長時間録画は ESP32 の安定性・電池を食う。実機で連続時間を確認。
- **混在コンテンツ**：アプリは `http://localhost`（非https）。プロキシも http なので問題なし（https配信すると映像がブロックされる＝[stage5 §7](stage5-wireless-camera.md) と同じ注意）。
- **モード切替スイッチ**：WiFi動作は「Cam(Run)」側（[stage5 §7](stage5-wireless-camera.md)）。録画も同条件。

---

## 6. 3機能の統合：セッション

「開始」を押した瞬間を `t0`、`sessionId`（例：開始時刻のISO文字列）を1つ決め、**軌跡ログのヘッダ・録画ファイル名・録画サイドカーで共有**する。これだけで：
- 動画 `recordings/<sessionId>.mp4` と ログ `<sessionId>.ndjson` が**同じ時刻軸**で並ぶ。
- 後から「この動画のこの瞬間、地図ではここ」を突き合わせられる（将来のリプレイビューアの土台）。

`sessionId`/`t0` の発行は `main.ts`（or 小さな `session-meta.ts`）の1箇所に集約。`RobotSession`（接続ライフサイクル、[session.ts](../../app/src/session.ts)）とは別概念（あちらは「接続の所有」、こちらは「記録の単位」）なので混ぜない。

---

## 7. 実装順序（各段で commit・既存の段階流儀に合わせる）

| 段 | 内容 | 触る所 | 実機要否 |
|---|---|---|---|
| **1** | **軌跡ログ（推定なし版）**：`logging/trajectory.ts`＋`download.ts`、`onTick` で生データ蓄積→NDJSON/CSV DL | Web層のみ | 不要（シムで検証） |
| **2** | **推測航法A（指令のみ）**：`localization/motion-model.ts`＋`estimator.ts`（+test）、`onTick` で推定 pose、`ui.ts` にトレイル描画 | Web層のみ | 不要（シムで検証） |
| **3** | **実測校正**：実機を走らせ `cmPerSec`/`degPerSec` を巻尺＋ストップウォッチで合わせる | `config.ts`/motion-model | **要**（USB/WiFi） |
| **4** | **IMU yaw（方式B）**：UNO に `case 24:` 追加（`CHANGES.md`記録）→ `serial-robot.read()` で**旋回境界だけ** yaw 問い合わせ→ `estimator` に渡す | UNO最小＋Web | 要 |
| **5** | **カメラ録画 R2→R3**：まず `ffmpeg -i <stream>` で録れるか確認（R2）→ `cam-proxy.mjs`（R3）で1本化＋CORS解決＋サイドカー | `tools/`＋`index.html`/`config.ts` | 要（WiFi） |
| **6**（任意） | **俯瞰カメラ真値（方式C）**：別系統で ArUco 追跡→真値 pose を取得、推定と並べて校正・デモ | 別ツール | 要 |
| **7**（任意） | **リプレイビューア**：保存NDJSON＋mp4 を `t` で同期再生、別校正で再推定 | `logging/replay.ts` | 不要 |

**最初の一手は段1〜2**（実機ゼロ・依存ゼロ・テスト可で「軌跡が地図に出る」が完成）。

---

## 8. 触るファイル一覧（層を尊重）

**新規（Web層・純関数中心）**
- `app/src/localization/motion-model.ts` … 実機校正値（純）
- `app/src/localization/estimator.ts` (+ `estimator.test.ts`) … 推測航法（純）
- `app/src/logging/trajectory.ts` (+ `trajectory.test.ts`) … 蓄積・整形（ほぼ純）
- `app/src/logging/download.ts` … Blob保存（副作用＝端）

**新規（Node・tools/）**
- `tools/cam-proxy.mjs` … 録画プロキシ＋ffmpeg（`ws-bridge.mjs` 流儀）
- `recordings/`（.gitignore へ追加）… mp4＋サイドカー出力先

**変更（最小）**
- `app/src/main.ts` … `onTick` に estimator＋logger を購読、`sessionId/t0` 発行、カメラURL切替、録画ボタン配線
- `app/src/ui.ts` … `draw()` に軌跡トレイル（任意引数）
- `app/src/config.ts` … `MotionModel` 既定値、`CAM_URL` をプロキシ切替可能に
- `app/index.html` … カメラ `src` をプロキシへ、録画/ログDLボタン
- `app/src/io/serial-robot.ts` … （段4）旋回境界で yaw 問い合わせ
- `arduino/SmartRobotCarV4.0_DIY/ApplicationFunctionSet_xxx0.cpp` … （段4）`case 24:` で yaw 返却＋`CHANGES.md`

**無変更（コアは触らない）**：`runner.ts` / `domain/cleaning.ts` / `protocol/protocol.ts`（yaw受け皿は既存）/ `io/robot.ts` / `sim/model.ts`。

---

## 9. 既知の制約・正直な注意（隠さない）

- **自己位置は「推定」**。エンコーダが無い以上、A/B はドリフトする。**画面・ログで必ず「推定」と明示**（[cleaning-logic-spec §5](cleaning-logic-spec.md) と整合）。「真値」は方式Cでだけ言える。
- **網羅率は保証しない**。軌跡が描けても「床の何%を拭いたか」は別問題。
- **yaw を足すと往復が増える**。毎tickではなく旋回境界だけ、で体感遅延を抑える（WiFiは特に）。
- **dtMs は実測を使う**。`tickMs` 名目だと `busy` ガードで伸びた分ぶん推定が走りすぎる。
- **録画は ESP32 の帯域・電池・発熱と相談**。長時間は実機で確認。同時接続はプロキシで1本化して回避。
- **CORS汚染**はプロキシ（localhost）で解く前提。R2/直URLのままブラウザ録画はできない可能性大。

---

## 10. 未確認事項（実機で潰す）

- `driveSpeed=120`/`turnSpeed=150`（PWM）の**実速度・実角速度**（→ `MotionModel` 校正。目標20〜30cm/s・60〜120°/s）。
- MPU6050 yaw の**符号・原点・ドリフト量**（`yawSign`/`yawOffsetDeg`、何分で何度ずれるか）。
- ESP32 純正firmwareの MJPEG が **CORSヘッダを返すか**（R1直結の可否）。
- ESP32 の **同時クライアント耐性**と AP越しの実 fps/解像度（録画品質の上限）。
- ffmpeg に連結JPEGを stdin で食わせる経路の安定性（`-f mjpeg pipe:0`）。境界パースの取りこぼし。
- 長時間録画＋自走時の**電池持ち**（4WD＋カメラ配信＋録画は電流大）。
- 俯瞰カメラ（C）採用時：ArUco ライブラリ選定（ブラウザ js-aruco / OpenCV.js）と座標系の対応付け。

---

## 11. 次

着手は **段1（軌跡ログ・推定なし）→ 段2（推測航法A）**。実機ゼロ・依存ゼロ・テスト可で「地図に軌跡が出る」まで一気に行ける。やる気が出たら本書を `stage6-trajectory-log.md` / `stage7-pose-estimate.md` / `stage8-camera-record.md` の実装段階mdに割って落とす。

---
関連：[code-design.md](code-design.md)（2層・onTick拡張）／ [vision-autonomy-and-cleaning-roadmap.md](../reference/vision-autonomy-and-cleaning-roadmap.md) §3.2（軌跡同期の構想）／ [current-build-spec.md](../reference/current-build-spec.md)（as-built）／ [machine-reference.md](../reference/machine-reference.md) §6.3,§9（IMU/プロトコル）／ [research-roomba-speed-and-motion.md](../reference/research-roomba-speed-and-motion.md)（速度の目標値）／ [stage5-wireless-camera.md](stage5-wireless-camera.md)（カメラ・Node中継）
</content>
</invoke>
