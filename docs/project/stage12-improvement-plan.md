# 段階12-計画：実機検証の結果 → 要件ベース改善計画

> **ゴール**：[stage12 実機検証](stage12-hardware-verification.md)（結果＝[_memo.md](_memo.md)）で出た問題を、**要件に紐づけて優先順位化**した改善ロードマップにする。実装は各項目を **TDD の別stage**（実装は red→green→smoke）に落とす。本書は「何を・なぜ・どの順で直すか」の計画。
> **なぜ**：実機で「**安全に止まらない**」「**録画が落ちる**」等、要件未達が判明した。憶測でなく**現物の結果**から、**要件充足の順に**潰す。ロジックは監査済み（app 145＋tools 19 テスト緑）なので、直すのは**実機/DOM/FS/ffmpeg の smoke 面**が中心。
> **前提**：stage7〜11 実装済み。原則は継続（**手足**／DDD／SRP／ハードコーディング排除／**副作用は端＝注入してテスト**）。**安全（R0）が全てに優先**。
> **このstageの位置**：[stage12 検証](stage12-hardware-verification.md)（現物を測る）→ 本書（結果を計画に）→ 実装stage群。

---

## 1. 要件（この計画の評価軸）

改善は「好み」でなく**要件充足**で順位づける。本プロジェクトの要件と**実機での現状**：

| 要件 | 内容 | 実機での現状 |
|---|---|---|
| **R0 安全（暗黙・絶対）** | 走行中いつでも**確実に停止**できる | ❌ **USB で停止不能**（抜線のみ）。WiFi は可 |
| **R1 軌跡ログ** | 移動軌跡を NDJSON/CSV で残す | ✅ USB/WiFi とも保存できた |
| **R2 カメラ録画** | 映像を mp4 保存＋ライブ表示維持 | ❌ **proxy が録画開始で落ちる**＝録画 end-to-end 未達 |
| **R3 推定軌跡の見せ方** | 地図に描く・**嘘を描かない**・「推定」明示 | △ トレイルは出る。だが **sim 旋回が実機と乖離**／**実機コーンが正面固定＝嘘** |
| **R4 賢い自走** | scan／reverse 等 | ✅ USB/WiFi とも scan・移動を確認 |
| 補：sim 忠実度 / usability | 開発用 sim が実機ばらい／操作の楽さ | △ sim 旋回ズレ／USB ポート選択が手間 |

> **原則**：**R0 が満たせるまで実機の自走テストは再開しない**（sim / bench で代替）。次に R2（録画＝現状ゼロ達成）、その後 R3（精度・忠実）。

---

## 2. 実機で判明したギャップ（要件 → 症状 → 原因）

| # | 要件 | 症状（[_memo](_memo.md)） | 原因（理解） |
|---|---|---|---|
| P0 | **R0** | USB 自走中、**停止/Esc/Space が無効**。抜線のみ | 明示停止（N=4 0/0×複数）が実機で効かず、**USB には ESP32 自動停止のような安全網が無い**。効かない機序は未切り分け |
| P1 | **R2** | `cam-proxy` が `rec/start` で `ENOENT 'recordings/...json'` → **プロセス落ち** | `ffmpeg-recorder.start()` が **sidecar `writeFile` を `spawn`(mkdir内包) より先**に呼ぶ→dir未作成。かつ http ハンドラ内の同期 throw で**プロセス死**。fake writeFile は実FS未接触で**ユニットが捕捉できなかった** |
| P2 | **R2** | 単一クライアントで app と直URLが競合／**走行負荷でストリームが落ちる**（app が消え直URLが映り出す） | ESP32 は stream 実質**1クライアント**＋制御トラフィックと競合。proxy(上流1本→分配)が設計解だが P1 で落ちていた。**上流再接続が無い**（既知の穴） |
| P3 | **R3/sim** | **sim の旋回が実機より全然小さい**／実機推定も未校正 | `SimConfig.maxTurnDegPerTick`(と maxDrive) が実機比で小さい。`motionModel` も placeholder（要実測） |
| P4 | **R3** | 実機スキャン中、首は振れているのに**コーンが正面固定**＝嘘 | 実機 `World.servoDeg` を `scanCenterDeg` 固定にし、**実 servo 指令を追っていない** |
| P5 | usability | **USB は Arduino IDE でポート選択しないと動かない** | CH340 ドライバ／ポート占有（IDE のシリアルモニタ等） |

---

## 3. 改善計画（優先順＝要件順）

| 優先 | 項目 | 要件 | 状態（実機検証後） |
|---|---|---|---|
| **P0** | USB 緊急停止＋deadman | R0 | ✅**解消**（P5 のクリーン接続で停止が効くように）。**deadman は未実装＝将来の多重防御として据え置き**。凍結は解除 |
| **P1** | cam-proxy クラッシュ修正 | R2 | ✅**実装済**（ensureDir 順序修正・呼び順テスト） |
| **P2** | proxy 単一上流＋再接続 | R2 | ⬜**未実装（残）** → [stage12-camera-reconnect](stage12-camera-reconnect.md) |
| **P3** | sim/motionModel 校正 | R3/sim | ⭕**[stage14](stage14-measured-only-sensor-view.md) で置換**（sim は実測から導出／**表示は実測のみで校正不要**） |
| **P4** | 実機コーンを正直に | R3 | ✅**実装済**（nextServoDeg）。※stage14 で**表示自体を実測のみに刷新** |
| **P5** | USB ポート手順 | usability | ✅**実装済**（README に CH340/IDE 手順） |

> **現況（一言）**：**残るは P2（カメラ再接続）だけ**。P0 は P5 で解消（deadman は据え置き）、P1/P4/P5 実装済、P3/P4 の「表示」方針は [stage14（実測のみ）](stage14-measured-only-sensor-view.md) が上書き。

---

## 4. 各項目の詳細

### P0：USB 緊急停止を効かせる＋deadman（R0・最優先）

- **症状**：USB 自走中、停止/Esc/Space が無効。抜線（＝電源断）でしか止まらない。WiFi は停止可（＋ブラウザ閉じで ESP32 自動停止）。
- **原因（理解）**：WiFi には **ESP32 の切断→`{"N":100}` 自動停止**という安全網があるが、**USB には無い**。加えて明示停止（`emergencyStop` の N=4 0/0）が実機で効いていない。機序（届いていない／N=4 0/0 が N=3 forward を止めない／停止後に forward が再送／writer 競合）は**未切り分け**。
- **方針（安全なので二段構え）**：
  1. **切り分け（smoke）**：Arduino シリアルモニタで、停止押下時に UNO が停止指令を受けモータが止まるか／N=4 0/0 が N=3 forward を上書きするか／停止後に forward が出ていないか。
  2. **ブラウザ側の確実化**：`runner.stop()` 後に forward が**絶対出ない**保証（既存ガードの検証・必要なら強化）＋ firmware が確実に honor する停止形（必要なら N=3 D2:0 併用）。
  3. **USB にも deadman**：WiFi の N=100 自動停止に相当する **「一定 ms 指令が来なければ停止」を UNO firmware に追加**（手足原則の範囲・安全のための最小改修）。明示停止が万一失敗してもハードで止まる。
- **検証**：`runner`/`session` の停止経路（停止後 forward 不送出）は **fake robot でユニット可**。firmware deadman・実停止は smoke（シリアルモニタ＋bench）。
- **触る所**：`app/src/runner.ts`/`session.ts`（停止経路の検証・強化）＋ `arduino/`（deadman＝任意だが安全上強く推奨。`CHANGES.md` に記録）。
- **ゲート**：**これが緑になるまで実機の自走テストは再開しない**（sim/bench のみ）。

### P1：cam-proxy クラッシュ修正（R2・ブロッカー）

- **症状**：`rec/start` で `ENOENT 'recordings/...json'` → proxy 死。録画不可。
- **原因（特定済）**：`start()` は **①sidecar `writeFile` → ②`spawn`（mkdir 内包）** の順。`recordings/` を作る `mkdirSync` が②側なので、①が先に走り **dir 未作成で ENOENT**。かつ http ハンドラ内の同期 throw で**プロセスごと落ちる**。
- **方針**：
  1. **順序修正**：出力 dir を **sidecar 書き込み前**に作る。DI 的に `ensureDir(dir)` を注入（or `writeFile` ラッパで dirname を mkdir）。cam-proxy の spawn 内 mkdir はやめ、**書き込み前に一度だけ**作る。
  2. **順序をテスト化**：controller に `ensureDir` を注入し、**`ensureDir` が `writeFile` より先に呼ばれる**ことをユニットで固定（fake で呼び順検証）＝**smoke でしか出なかった穴をテストに落とす**。
  3. **プロセスを殺さない**：`rec/start` ハンドラを try/catch し、失敗は 500 を返して **proxy は生存**。
- **検証**：ユニット（ensureDir 順序・ハンドラの例外握り）＋ smoke（`rec/start` で `recordings/` と mp4 が実生成・再生可）。
- **触る所**：`tools/lib/ffmpeg-recorder.mjs`（ensureDir 注入・順序）／`tools/cam-proxy.mjs`（deps・try/catch）。

### P2：proxy を単一上流に集約＋上流再接続（R2・実運用）

- **症状**：単一クライアント競合／走行負荷でストリーム断（app 消え・直URL 映る）。
- **原因**：ESP32 は stream 実質1クライアント＋制御と競合。proxy が設計解だが再接続が無く、落ちたら復帰しない。
- **方針**：
  1. P1 修正後、**app は必ず proxy 経由（`useProxy`）で 1 上流に集約**し、直URLは運用で覗かない（競合を作らない）。
  2. **上流再接続**を cam-proxy に追加（`up.on("close"|"error")→バックオフ再接続）。負荷で落ちても復帰。再接続スケジューラは**純関数に切り出してユニット**、実挙動は smoke。
  3. 負荷が高すぎる場合の低減（解像度/fps・制御周期）は smoke 結果しだいの調整。
- **検証**：再接続ロジックは一部ユニット／走行中に映像維持・復帰は smoke。**同時stream数（[stage12 D2](stage12-hardware-verification.md)）を明示確定**。
- **触る所**：`tools/cam-proxy.mjs`（再接続）＋運用（`useProxy` 前提）。

### P3：sim / motionModel 校正（R3・sim 忠実度）

- **症状**：sim の旋回が実機より全然小さい／実機推定も未校正。
- **原因**：`defaultSimConfig.maxTurnDegPerTick`（と maxDrive）が実機比で小さい。`defaultMotionModel` は placeholder。
- **方針（config 集約・ハードコーディング排除の作法）**：
  1. **sim**：`defaultSimConfig` の maxTurn/maxDrive を、`turnTicks` で約90度・駆動が実機ばらいになるよう調整（[stage12 フェーズC](stage12-hardware-verification.md) の実測を流用）。
  2. **実機推定**：`defaultMotionModel`（forwardCmPerSec/turnDegPerSec）に実測を反映。
- **検証**：定数＝テスト不要（tsc）。sim 目視で旋回が実機ばらい／実機トレイルが現実に寄る（smoke）。
- **触る所**：`app/src/config.ts`（`defaultSimConfig`/`defaultMotionModel` の値）。ロジック無改造。

### P4：実機のスキャンコーンを正直に（R3・嘘を描かない）

- **症状**：実機スキャン中、首は振れているのにコーンが正面固定＝嘘。
- **原因**：実機 `World.servoDeg` を `scanCenterDeg` 固定にし、`cleaning` が出す `aimDeg`（スキャン指令）を追っていない。
- **方針（要件＝嘘を描かない に忠実に。A 推奨）**：
  - **A（真実を描く）**：`cleaning` の `cmd.aimDeg` を拾って `World.servoDeg` に反映＝コーンが**実際の首指令方向**へ動く。`pose-source`/estimator が `servoDeg` も持つ。ただし指令≠実測（オープンループ）なので**「指令方向」と明示**。
  - B（最小）：実機スキャン中はコーンを**正面固定と明示** or 非表示にし、距離だけ出す。
- **検証**：`aimDeg→servoDeg` 反映は純関数化して**ユニット可**。見た目は smoke。
- **触る所**：`telemetry/pose-source`(or estimator)（servoDeg 追従）・`main.ts`（render の `world.servoDeg`）。`ui/` は無改造（既に servoDeg を使う）。

### P5：USB ポート手順の整備（usability・低）

- **症状**：Arduino IDE でポート選択しないと動かない。
- **原因**：CH340 ドライバ／ポート占有（IDE のシリアルモニタが掴む等）。
- **方針**：**文書化**（CH340 導入・IDE のシリアルモニタを閉じる・Chrome の requestPort でのポート選び方）。コード修正は基本不要。→ [stage12 §8](stage12-hardware-verification.md) or README に追記。
- **検証**：手順で解消するか smoke。

---

## 5. 実施順序とゲート

```
✅P0(解消:P5で停止可) ─▶ ✅P1(録画開通) ─▶ ⬜P2(走行中も録画を保つ:残) → stage12-camera-reconnect
   （P3/P4 の「表示」は stage14「実測のみ」で刷新／✅P4 nextServoDeg・✅P5 済／deadman は据え置き）
```
- **P0 は P5 のクリーン接続で解消＝実機自走テストの凍結は解除**（停止が効く）。deadman(多重防御)は未実装＝将来据え置き。
- **残作業は実質 P2（カメラ再接続）だけ**。R2 を「動く→保つ」で仕上げる。
- 各実装は TDD：**smoke でしか出なかった穴は可能な限りユニット化**（P0 停止ガード・P1 ensureDir 順序・P2 再接続・P4 servoDeg 反映）。残る実機/FS/ffmpeg は smoke。

---

## 6. 触らない（動作確認済み）／据え置き

- **動く（据え置き）**：R1 軌跡ログの保存（USB/WiFi）／R4 scan・移動／WiFi 自走・停止・自動停止。**回帰させない**（既存テスト＋P0/P1 の新ユニットで守る）。
- **据え置き（将来）**：本物の自己位置推定（IMU yaw／俯瞰ArUco）は本計画外（[design-trajectory-recording-architecture.md](../reference/design-trajectory-recording-architecture.md)）。ESP32 の帯域限界を超える高fps録画も将来。

---

## 7. 実装後にやること
- 実機確認の結果（**USB deadman の有無・同時stream数・校正値・電池持ち**）を [current-build-spec.md](../reference/current-build-spec.md) に反映。
- [stage12 検証手順](stage12-hardware-verification.md) の該当チェックを再走し、P0〜P2 の合格条件を満たすか確認。

---
関連：[stage12-hardware-verification.md](stage12-hardware-verification.md)（検証手順・結果の測り方）／ [_memo.md](_memo.md)（今回の実機結果）／ [stage8b](stage8b-recording-pipeline.md)（ffmpeg-recorder/proxy・§5 再接続）／ [stage11](stage11-sim-tactical-map.md)（コーン＝嘘を描かない）／ [current-build-spec.md](../reference/current-build-spec.md)（結果の反映先）／ [code-design.md](code-design.md)（手足・注入テスト）
</content>
