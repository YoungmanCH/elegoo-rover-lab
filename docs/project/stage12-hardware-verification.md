# 段階12：実機検証手順（stage7〜11 の現物確認 smoke）

> **ゴール**：stage7〜11 はユニット＋型では緑だが、**実機/DOM/ffmpeg は smoke 送り**で未確認。本書はそれを**現物で確かめる手順**。安い順（シム→USB→校正→WiFi→録画）に並べ、各ステップに**合格条件（✅）**と**何を検証するか**を付ける。
> **これは「コードのバグ探し」ではなく「現物合わせ」**：ロジックは [監査済み](stage11-sim-tactical-map.md)（app 145＋tools 19 テスト・strict型クリーン）。ここで潰すのは①実機軌跡の精度（要校正）②カメラ録画の end-to-end ③ESP32の挙動（同時stream/帯域/再接続）④canvas/DOM の目視。
> **安全**：自走ロボットは暴走しうる。**広い場所**で、**停止（停止ボタン/Esc/Space）を常に指先に**、電源スイッチで物理 OFF できる体勢で。満充電で。
> 名前は stage でなくてもよい（実機検証 runbook）。関連：各stageの DoD（[7d](stage7d-recorder-and-ui.md)/[8b](stage8b-recording-pipeline.md)/[8c](stage8c-browser-and-sync.md)/[9](stage9-main-single-responsibility.md)/[10](stage10-ui-layout-and-safety.md)/[11](stage11-sim-tactical-map.md)）。

---

## 0. 準備（共通）

### 0.1 ハード/ソフト
- ELEGOO 組付け済み・**18650 満充電**・USBケーブル・ノートPC（**Chrome/Edge**＝Web Serial 必須）。
- **ffmpeg** 導入済み（`which ffmpeg`。録画 = cam-proxy が spawn）。

### 0.2 起動するプロセス（フェーズで使い分け）
| プロセス | コマンド | 何用 | 使うフェーズ |
|---|---|---|---|
| Vite（アプリ） | `cd app && npm run dev` → Chrome で `http://localhost:5173/` | 画面・操作 | 全部 |
| WS中継 | `cd tools && node ws-bridge.mjs`（:8081） | **WiFi で“制御”** | D2以降 |
| カメラproxy | `cd tools && node cam-proxy.mjs`（:8082） | **カメラ表示＋録画** | E以降 |

### 0.3 ⚠️ モード切替スイッチ（最頻ハマり所）
ボード上の **Upload / Cam(Run)** スイッチ：
- **USB で制御** → **Upload 側**（USB シリアルが UNO に繋がる）。
- **WiFi で制御＋カメラ** → **Cam(Run) 側**（ESP32 が UNO に繋がる）。USB は抜く（バッテリ駆動）。
> 逆だと「**コマンドは届くのにセンサ応答が返らない**」（[stage5 §7](stage5-wireless-camera.md)）。WiFi で `{Heartbeat}` しか来ないときは真っ先にこれを疑う。

---

## 1. フェーズA：シムだけで UI・軌跡ログを確認（実機不要・最初に）

実機ゼロで stage7/9/10/11 の大半を潰す。Vite だけ起動。

| # | 操作 | ✅合格条件 | 検証 |
|---|---|---|---|
| A1 | アプリを開く | 暗 canvas に **50cm 格子**・**機体マーカー（シェブロン＋中心ドット）**・**リードアウト `X Y YAW AIM DIST`** が出る | stage10/11 HUD |
| A2 | **開始** | 機体が自走。**トレイルが伸びてフェード**／壁<20cm で**スキャンコーンが出て向きが回り**、壁際で**縮む**／終端の**ゴールド点が壁に乗る** | stage11（コーン＝実測・嘘なし）／stage7 trail |
| A3 | **停止** → **save-ndjson** | ファイル DL。開くと **1行目 header＋tick 行**、各行 valid JSON、`estimated:false`（sim=真値）、`pose` がトレイルと一致 | stage7 ログ／stage9 lifecycle |
| A4 | **save-csv** | 同じ列（`t,dt,…,x,y,yawDeg,estimated`）の CSV が DL | stage7 CSV |
| A5 | 開始→停止を数回 | 毎回 sessionId が変わり、新しい軌跡が空から積まれる（前回が混ざらない） | stage9 再start差し替え |

> ここが全部通れば **stage7/9/10/11 のロジック＆配線は実機なしで OK**。落ちたらまず DevTools Console を見る（DOM セレクタ/描画）。

---

## 2. フェーズB：USB 実機で自走＋推定軌跡

**モード=Upload・USB 接続**。広い床。

| # | 操作 | ✅合格条件 | 検証 |
|---|---|---|---|
| B1 | スイッチ Upload／USB 挿す／電源ON。アプリで **実機接続（USB）**→ポート選択 | Console `実機接続OK` | Web Serial/protocol |
| B2 | 床に置いて **開始** | 前進し、**前方約20cmで停止→首振りスキャン→空いた方へ旋回**（両側塞がりは後退＋180） | stage6 挙動（scan/reverse） |
| B3 | 走行中、地図を見る | **推定トレイル**が伸びる（`estimated:true`）。形（直進＋旋回）が実挙動と概ね一致。コーンは**body正面固定**（実機 servo は中央） | stage7 実機推定／stage11 |
| B4 | **停止 / Esc / Space** | 即停止（stop を複数回送出）。暴走しない | stage9/安全 |
| B5 | **save-ndjson** | `estimated:true`、`distanceCm` が実測値（整数）、`source:"usb"` | stage7 実機ログ |

> ⚠️ この時点で**推定軌跡の“形”はズレている**のが正常（未校正）。精度は次のフェーズC。

---

## 3. フェーズC：motionModel 校正（実機軌跡の精度＝最重要の現物合わせ）

既定 `motionModel` は**プレースホルダ**。実測して `app/src/config.ts` の `defaultMotionModel` を更新する。

| # | 実測 | 計算 | 入れる場所 |
|---|---|---|---|
| C1 | 開けた直線で **開始**→直進区間を**巻尺で距離D[cm]・ストップウォッチで時間T[s]** | `forwardCmPerSec = D / T` | `defaultMotionModel.forwardCmPerSec`（`refDriveSpeed` は現 `driveSpeed=80` のまま） |
| C2 | 1回の**その場旋回**の角度θ[°]を実測（床にテープで前後の向き）。所要 = `turnTicks(6) × tickMs(120)/1000 = 0.72s` | `turnDegPerSec = θ / 0.72`（θ≈90°なら ≈125） | `defaultMotionModel.turnDegPerSec`（`refTurnSpeed` は現 `turnSpeed=100`） |
| C3 | 値を入れて B を再走行 | **推定トレイルが実挙動に寄る**（直進長・旋回角が現実に近づく） | 推定精度（監査の残課題①） |

> 後退する運用なら `reverseCmPerSec` も同様に実測。**満充電で校正**（電圧低下で速度・旋回角は落ちる）。それでも開放ループ＝**ループは閉じない**（ドリフトは残る・UI は「推定」明示のまま）。

---

## 4. フェーズD：WiFi 接続＋カメラ（ライブ・録画なし）

**モード=Cam(Run)・USB 抜く・バッテリ駆動**。PC の WiFi を **`ELEGOO-xxxx`（オープン）** に接続。

| # | 操作 | ✅合格条件 | 検証 |
|---|---|---|---|
| D1 | ブラウザで `http://192.168.4.1/`（または `:81/stream`） | **カメラ映像が出る**（ESP32 生存） | ESP32/カメラ |
| D2 | **同時stream数テスト**：`:81/stream` を**2タブで同時に開く** | 両方映る＝**2以上OK**／2つ目で1つ目が落ちる＝**1のみ** → 結果を記録 | **決定的未確認**（[8b §0](stage8b-recording-pipeline.md)）。1ならプロキシ必須 |
| D3 | `node ws-bridge.mjs` 起動 → アプリで **WiFi接続** | Console `WiFi接続OK`／中継ログ `ESP32 connected` | WiFi 制御経路 |
| D4 | **開始** | 無線で自走（`[tick] dist=…` が流れる）／**停止/Esc/Space で止まる**（ブラウザ閉じても ESP32 自動停止） | WiFi 自走/安全弁 |

> D3 でアプリのカメラ枠が出ないのは正常（既定 `useProxy:true` ＝ proxy 経由表示。proxy はフェーズE で起動）。直URL表示を試すなら `config.recordingConfig.useProxy=false`。

---

## 5. フェーズE：cam-proxy ＋ 録画（stage8 end-to-end ＋ stage8c 同期）

`ELEGOO-xxxx` に接続済みのまま、別ターミナルで proxy を起動。

| # | 操作 | ✅合格条件 | 検証 |
|---|---|---|---|
| E1 | `cd tools && node cam-proxy.mjs` → ブラウザで `http://localhost:8082/stream` | カメラ映像が出る（**proxy が上流1本を再配信**） | demux＋multipart 再配信／CORS |
| E2 | `curl -X POST "http://localhost:8082/rec/start?session=test"` → 5〜10秒 → `curl -X POST http://localhost:8082/rec/stop` | `tools/recordings/test.mp4` が**再生でき・実時間長**／`test.json`(サイドカー)が出る | ffmpeg で mp4 生成（stage8b） |
| E3 | rec/start を**2回連続** | 2回目が **409 already recording**（旧 ffmpeg をリークしない） | ffmpeg-recorder 二重起動ガード |
| E4 | **アプリ統合**：ws-bridge＋cam-proxy 両起動下で **WiFi接続** | アプリのカメラ枠に映像（`cameraStreamUrl`＝proxy） | stage8c 表示配線 |
| E5 | **開始** | 自走＋**録画開始**（`tools/recordings/<id>.mp4` が育つ）＋トレイル記録 | stage8c：WiFi時のみ recStart |
| E6 | **停止** → **save-ndjson** | mp4 が確定／NDJSON の header `videoFile` ＝ **`<id>.mp4`**（同 sessionId）。mp4 ファイル名と一致 | **stage8c 同期**（動画⇔軌跡） |
| E7 | mp4 と ndjson を突き合わせ | サイドカー `startedAtIso`／ffmpeg wallclock と軌跡 `t` で時刻が対応 | 時刻軸同期 |

> sim/USB で 開始しても録画は始まらない（`videoRecordable()=connSource==="wifi" && useProxy`）＝正常。`videoFile` は WiFi 以外 `null`。

---

## 6. 合否チェックリスト（一覧・stage の DoD と対応）

- [ ] **A**（sim）：HUD・コーン・トレイル・NDJSON/CSV DL（stage7/9/10/11）
- [ ] **B**（USB）：実機自走・stage6 挙動・推定トレイル・確実停止
- [ ] **C**（校正）：`forwardCmPerSec`/`turnDegPerSec` 実測反映→軌跡が現実に寄る
- [ ] **D**（WiFi）：ESP32 生存・**同時stream数を確定**・無線自走・自動停止
- [ ] **E**（録画）：proxy 再配信・**mp4 が再生可**・409 ガード・**`videoFile`＝`<id>.mp4` 一致**
- [ ] 実機確認の結果（特に D2 の同時stream数・C の校正値・F の電池）を [current-build-spec.md](../reference/current-build-spec.md) に追記

---

## 7. つまずきポイント（先回り）
- **モード切替**：制御不能/センサ無応答はまずこれ（§0.3）。
- **WiFi 時は USB を抜く**（UART を USB と ESP32 が共有）。
- **proxy/中継の起動順**：先に `ELEGOO-xxxx` に接続 → それから `cam-proxy`/`ws-bridge`（先に立てると上流 TCP/HTTP に繋がらない）。
- **混在コンテンツ**：アプリは `http://localhost`、proxy も http なので可。**https 配信すると映像がブロック**される。
- **録画が空/壊れる**：`which ffmpeg` を確認（cam-proxy が `spawn("ffmpeg")`）。`tools/recordings/` の書き込み権限。
- **カメラ枠が出ない（WiFi）**：既定 `useProxy:true` なので **cam-proxy 未起動だと出ない**（localhost:8082）。proxy を立てるか `useProxy=false`。
- **暴走**：停止/Esc/Space、最後は電源スイッチ。WiFi はブラウザ/中継を閉じれば ESP32 が `{"N":100}` で自動停止。

---
関連：[stage5-wireless-camera.md](stage5-wireless-camera.md)（WiFi/カメラ/モードスイッチ）／ [stage8b](stage8b-recording-pipeline.md) §0,§5（同時stream/再接続）／ [stage8c](stage8c-browser-and-sync.md)（同期）／ [stage11](stage11-sim-tactical-map.md)（HUD/コーン）／ [current-build-spec.md](../reference/current-build-spec.md)（結果の反映先）
</content>
