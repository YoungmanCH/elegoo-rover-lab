# 段階7：軌跡ログ ＋ カメラ録画（TDD・用途別ファイル分割の設計）

> **ゴール**：①走った**軌跡を残す**（地図にトレイル描画＋NDJSON/CSV保存）②**カメラ映像を録画**（ライブ表示は維持したまま mp4 保存）。
> **設計の肝**：軌跡の位置は **`sim/model.ts` の運動学を推測航法（dead-reckoning）として流用した推定**（モデルベース）で出す。**完全な自己位置推定（IMU yaw / 俯瞰ArUco）は本段階の範囲外**＝[design-pose-trajectory-recording.md](../reference/design-pose-trajectory-recording.md) と将来段階に残す。位置は必ず「推定」と明示する。
> **本書の主役は TDD**：すべての純ロジックは**テストを先に書いてから実装**する（red→green→refactor）。各モジュールに「テスト仕様（先に書く）」を載せ、最後に**そのテストで本当に足りるかを追跡表（トレーサビリティ）で検証**する。
> **前提**：[stage6-scan-and-reverse.md](stage6-scan-and-reverse.md) までの状態。現状仕様は [current-build-spec.md](../reference/current-build-spec.md)、層分け原則は [code-design.md](code-design.md)、カメラ/中継の素地は [stage5-wireless-camera.md](stage5-wireless-camera.md)、プロトコルは [machine-reference.md](../reference/machine-reference.md) §9。
> **編集はあなた**。本書は設計スケッチ（before/after・テスト仕様）。コメントの括弧は半角。

---

## 0. なにを作るか（要点）

| # | 機能 | 何で実現するか | 新ハード | firmware |
|---|---|---|---|---|
| 1 | **軌跡の位置（推定）** | sim の運動学カーネルを流用した推測航法推定器（指令＋実dt） | 不要 | 無改造 |
| 2 | **軌跡ログ（保存）** | `onTick` 購読→tickサンプル蓄積→NDJSON/CSV ダウンロード | 不要 | 無改造 |
| 3 | **軌跡の描画** | `ui.ts` にトレイル（パンくず）を追加 | 不要 | 無改造 |
| 4 | **カメラ録画** | Node 録画プロキシ（1上流→ブラウザ＋ffmpeg）→ mp4 | 不要 | 無改造 |
| 5 | **動画⇔軌跡の同期** | セッション（`sessionId` / `t0`）を両者で共有 | 不要 | 無改造 |

> **設計変更の肝**：`runner.ts` と `domain/cleaning.ts` は**無改造**。観測フック `onTick(state, sensors, cmd)`（[runner.ts:19](../../app/src/runner.ts)・[code-design §6.1](code-design.md) で拡張済み）に「記録」をぶら下げ、位置推定とシリアライズは**純関数**に閉じ込める。これで実機ゼロ・テスト先行で 1〜3 が完成し、4 は Node 側（`ws-bridge.mjs` と同じ思想）に隔離される。

---

## 1. DDD：用途で層を割る（ユビキタス言語と依存方向）

「実装が多いときは用途ごとにファイルを分ける」を、DDD の**層**で徹底する。**依存は内向き**（Infrastructure → Application → Domain）。Domain は外（DOM/ネット/時計）を一切知らない＝**全部純関数＝全部テストできる**。

```
┌ Domain（純・不変・テスト100%狙い） ───────────────────────────────┐
│  Pose / Kinematics（運動学カーネル）                                │
│  MotionModel + commandToDelta（校正→1tickの移動量・回転量）          │
│  PoseEstimator（推測航法推定: pose を1tick進める）                         │
│  TickSample / Trajectory（記録の値オブジェクトと集約）               │
│  serialize（Trajectory → NDJSON / CSV）                              │
└───────────────▲───────────────────────────────────────────────────┘
                │ （Domain にのみ依存）
┌ Application（オーケストレーション・注入でテスト可） ─────────────────┐
│  TrajectoryRecorder（onTick→sample→集約。clock/PoseSource を注入）    │
│  PoseSource «interface»  ├ SimPoseSource（真値）                     │
│                          └ EstimatorPoseSource（推定＝Domain使用）   │
└───────────────▲───────────────────────────────────────────────────┘
                │ （Application/Domain に依存。外界はここだけ）
┌ Infrastructure（副作用＝端に隔離・smoke検証） ─────────────────────┐
│  download（Blob/<a>） / camera(stream-url, recorder-client)         │
│  tools/cam-proxy.mjs（MJPEG中継＋ffmpeg） / tools/lib/mjpeg-demux    │
│  main.ts（配線） / ui.ts（描画）                                     │
└───────────────────────────────────────────────────────────────────┘
```

### ユビキタス言語（用語の定義＝命名の正本）
| 用語 | 意味 | 置き場所 |
|---|---|---|
| **Pose** | 姿勢 `{x,y,yawDeg}`（cm・度・CCW+・0=+x）。core 値オブジェクト | `types.ts`（sim から移設） |
| **Kinematics** | 「移動量cm・回転量deg → 新 Pose」の純粋運動学。世界（壁）を知らない | `domain/kinematics.ts` |
| **MotionModel** | 校正値（cm/s・deg/s）。PWM→物理量の対応 | 型`types.ts`／値`config.ts` |
| **PoseEstimator** | 指令＋実dt から Pose を進める推測航法推定器（ドリフトする＝推定） | `localization/pose-estimator.ts` |
| **PoseSource** | 「次の Pose をくれ」の抽象。真値(Sim)/推定(Estimator) を差し替える | `telemetry/pose-source.ts` |
| **TickSample** | 1tick分の記録（時刻・指令・センサ・相・Pose・推定フラグ） | `telemetry/sample.ts` |
| **Trajectory** | ヘッダ＋サンプル列の集約 | `telemetry/trajectory.ts` |
| **session 識別子** | `sessionId`＋`t0`。軌跡と動画を束ねる鍵（id/ヘッダ生成） | `telemetry/session-meta.ts` |

> **モデルベースの徹底**：シム（真値）も実機（推定）も**同じ運動学カーネル `integratePose` を共有**する。`sim/model.ts` の `advance()` を「カーネル＋壁クランプ」に**リファクタ**し、推定器は「カーネル＋クランプ無し（部屋を知らないので外へドリフトしてよい）」にする。1つの運動方程式を2用途で使い回す＝重複排除（DRY）＋整合保証。

---

## 2. ファイル分割（新規／変更の一覧）

```
app/src/
├── domain/
│   ├── kinematics.ts            # 新規・純: integratePose（運動学カーネル＝モデル中核）
│   └── kinematics.test.ts
├── localization/
│   ├── motion-model.ts          # 新規・純: commandToDelta（校正→移動量/回転量）
│   ├── motion-model.test.ts
│   ├── pose-estimator.ts        # 新規・純: estimateStep（推測航法推定の1tick）
│   └── pose-estimator.test.ts
├── telemetry/
│   ├── sample.ts                # 新規・純: makeSample（TickSample 組み立て）
│   ├── sample.test.ts
│   ├── trajectory.ts            # 新規・純: createTrajectory（蓄積・集約）
│   ├── trajectory.test.ts
│   ├── serialize.ts             # 新規・純: toNDJSON / toCSV（列定義は単一正本）
│   ├── serialize.test.ts
│   ├── pose-source.ts           # 新規: PoseSource 抽象＋Sim/Estimator 実装
│   ├── pose-source.test.ts
│   ├── recorder.ts              # 新規・App: TrajectoryRecorder（clock/PoseSource 注入）
│   ├── recorder.test.ts
│   ├── session-meta.ts          # 新規・純: newSessionId / makeHeader
│   ├── session-meta.test.ts
│   ├── download.ts              # 新規・Infra: Blob保存（純部分=ファイル名のみテスト）
│   └── recording-session.ts     # 新規・App: 記録の寿命・状態・直列化を所有（factory・注入／stage9）
├── camera/
│   ├── stream-url.ts            # 新規・純: cameraStreamUrl（proxy/direct 選択）
│   ├── stream-url.test.ts
│   ├── control-url.ts           # 新規・純: recControlUrl（録画制御URL組立）
│   └── recorder-client.ts       # 新規・Infra: 録画開始/停止を proxy へ（fetch・URL組立は純でテスト）
├── sim/model.ts                 # 変更: advance() を integratePose＋clamp へ（既存testは緑のまま）
├── types.ts                     # 変更: Pose 移設＋MotionModel/TickObservation/TickSample/Header 等を追加
├── config.ts                    # 変更: motionModel / recording / telemetry を追加（ハードコーディング集約）
├── ui/                          # 変更→分割(stage10/11): draw(オーケストレータ)/geometry/readout/theme
├── style.css                    # 新規(stage10): ページ全体の HUD スタイル（index.html が link）
├── runner.ts                    # 無改造
├── domain/cleaning.ts           # 無改造
└── main.ts                      # 変更: recorder＋camera＋session を配線

tools/
├── cam-proxy.mjs                # 新規・Infra: MJPEG 1上流→(ブラウザ＋ffmpeg) 分配・mp4録画
├── cam-config.mjs               # 新規: cam-proxy の設定(定数)。lib=純テスト済み なので config は top 直下
├── lib/
│   ├── mjpeg-demux.mjs          # 新規・純: バイト列→JPEGフレーム抽出（チャンク分割に強い）
│   └── mjpeg-demux.test.mjs
└── recordings/                  # 出力先（.gitignore に追加）
```

**SRP の確認**：1ファイル=1責務。「運動学」「校正」「推定」「サンプル化」「蓄積」「整形」「PoseSource」「記録オーケストレーション」「保存」「URL選択」「MJPEG分解」を**全部別ファイル**にした（混ぜると純度とテスト容易性が落ちる）。

---

## 3. 型（`app/src/types.ts`）— 契約を1か所に

```ts
// Pose を sim/model.ts からここへ移設（core 値オブジェクト。sim 専用ではない）。
export type Pose = { x: number; y: number; yawDeg: number };

/** PWM→物理量の校正（推定の唯一の根拠。値は config.ts）。 */
export type MotionModel = {
    forwardCmPerSec: number;    // forward(driveSpeed) の実速度[cm/s]。要実測(§9)
    reverseCmPerSec: number;  // reverse(reverseSpeed) の実速度[cm/s]
    turnDegPerSec: number;    // rotate(turnSpeed) の実角速度[deg/s]。要実測(§9)
    refDriveSpeed: number;    // 上記 cm/s を測った時の前進PWM(速度スケール基準)
    refTurnSpeed: number;     // 上記 deg/s を測った時の旋回PWM
};

/** 1tick分の生の観測（makeSample の入力）。recorder が毎tick組み立てる。cmd/sensors はネストのまま。 */
export type TickObservation = {
    t: number; dt: number; cmd: Command; sensors: Sensors; phase: State["phase"]; pose: Pose; estimated: boolean;
};

/** 1tick分の記録（軌跡ログの最小単位＝makeSample の出力）。TickObservation を平坦化＋丸めした形。 */
export type TickSample = {
    t: number;            // セッション基準 t0 からの相対[ms]（動画と同じ時間軸）
    dt: number;           // 直前tickからの実経過[ms]（推定に使った値）
    cmdKind: Command["kind"];
    speed: number;
    distanceCm: number;
    lifted: boolean;
    phase: State["phase"];
    pose: Pose;           // sim=真値 / 実機=推定
    estimated: boolean;   // true=推定(実機) / false=真値(sim)
};

/** 軌跡ログのヘッダ（自己記述的：再現に要る文脈を全部入れる）。 */
export type TrajectoryHeader = {
    v: number;
    sessionId: string;
    startedAtIso: string;
    source: "sim" | "usb" | "wifi";
    config: Config;
    motionModel: MotionModel;
    pose0: Pose;
    videoFile: string | null;   // ③カメラ録画ファイル名（無ければ null）
};
```

> Pose 移設に伴い `sim/model.ts` / `sim/model.test.ts` / `ui.ts` の import を `../types` へ向け替える（**機械的移動。既存テストが緑のままを確認**）。

---

## 4. Domain：運動学カーネル（モデルベースの中核）

### 4.1 `app/src/domain/kinematics.ts`（新規・純）
```ts
// kinematics.ts — 2D 剛体の運動学(純)。世界(壁)を知らない＝クランプしない。
// シム(真値)も推定器も「この1つの式」を共有する＝モデルの単一正本。
import type { Pose } from "../types";

/**
 * pose に「回転 turnDeg → 進行 moveCm(向き後の前方)」を適用した新 Pose を返す。
 *   moveCm 負 = 後退 / turnDeg 正 = 反時計回り(CCW)。yaw は折り返さない(連続値)。
 *   ※壁での停止はここでは扱わない(部屋を持つ sim 側の責務)。
 */
export function integratePose(pose: Pose, moveCm: number, turnDeg: number): Pose {
    const yaw = pose.yawDeg + turnDeg;            // 先に回す
    const rad = (yaw * Math.PI) / 180;
    return {
        x: pose.x + Math.cos(rad) * moveCm,       // 回った後の向きへ進む
        y: pose.y + Math.sin(rad) * moveCm,
        yawDeg: yaw,
    };
}
```

**テスト仕様（`kinematics.test.ts`／先に書く）**
| ID | ケース | 期待 |
|---|---|---|
| K1 | 前進 yaw=0, move=10, turn=0 | x+=10, y/yaw 不変 |
| K2 | 前進 yaw=90 | y+=10, x 不変 |
| K3 | 前進 yaw=180 | x-=10 |
| K4 | 後退 move=-10, yaw=0 | x-=10 |
| K5 | 回転のみ move=0, turn=30 | yaw+=30, x/y 不変 |
| K6 | 回転＋前進 | **先に回って**から新向きへ進む（順序の固定） |
| K7 | クランプしない | 部屋外の座標になっても止めない（sim との責務分離） |
| K8 | 連続yaw | turn を足し続けても 360 で折り返さない |
| K9 | 純粋性 | 入力 pose を破壊しない |

### 4.2 `app/src/sim/model.ts`（変更：カーネルへ委譲）
```ts
import { integratePose } from "../domain/kinematics";

export function advance(w: World, cmd: Command, sc: SimConfig): World {
    const servoDeg = cmd.aimDeg ?? w.servoDeg;          // (段階6で追加済み)
    if (cmd.kind === "forward" || cmd.kind === "reverse") {
        const sign = cmd.kind === "reverse" ? -1 : 1;
        const move = sign * (cmd.speed / 255) * sc.maxDriveCmPerTick;
        const p = integratePose(w.pose, move, 0);
        return { servoDeg, pose: {                       // ★壁クランプは sim の責務(ここだけ)
            x: clamp(p.x, 0, sc.roomW), y: clamp(p.y, 0, sc.roomH), yawDeg: p.yawDeg } };
    }
    if (cmd.kind === "rotateLeft" || cmd.kind === "rotateRight") {
        const a = (cmd.speed / 255) * sc.maxTurnDegPerTick;
        const dir = cmd.kind === "rotateLeft" ? 1 : -1;
        return { servoDeg, pose: integratePose(w.pose, 0, dir * a) };
    }
    return { ...w, servoDeg };
}
```
> **TDD のリファクタ**：`integratePose` を**先にテスト緑**にしてから `advance` を委譲に書き換える。**既存 `model.test.ts`（K相当の advance テスト）が緑のまま**＝振る舞い不変の証明（refactor の安全網）。

---

## 5. Domain：校正と推定（推測航法(dead-reckoning)）

### 5.1 `app/src/localization/motion-model.ts`（新規・純）
```ts
// motion-model.ts — 指令＋実経過 dt から「この1tickの移動量cm・回転量deg」を出す(純)。
// 速度(PWM)は基準値に対して線形と近似(ラフだが校正で吸収)。数値は config(MotionModel)から。
import type { Command, MotionModel } from "../types";

// 戻り値は「1tick分の移動量cm・回転量deg（運動の差分）」。この関数の戻り値専用なので型は付けずインライン。
export function commandToDelta(cmd: Command, dtMs: number, m: MotionModel): { moveCm: number; turnDeg: number } {
    const sec = dtMs / 1000;
    switch (cmd.kind) {
        case "forward":
            return { moveCm: m.forwardCmPerSec * (cmd.speed / m.refDriveSpeed) * sec, turnDeg: 0 };
        case "reverse":
            return { moveCm: -m.reverseCmPerSec * (cmd.speed / m.refDriveSpeed) * sec, turnDeg: 0 };
        case "rotateLeft":
            return { moveCm: 0, turnDeg: +m.turnDegPerSec * (cmd.speed / m.refTurnSpeed) * sec };
        case "rotateRight":
            return { moveCm: 0, turnDeg: -m.turnDegPerSec * (cmd.speed / m.refTurnSpeed) * sec };
        case "stop":
            return { moveCm: 0, turnDeg: 0 };
    }
}
```

**テスト仕様（`motion-model.test.ts`）**
| ID | ケース | 期待 |
|---|---|---|
| M1 | forward, 基準速, dt=1000 | moveCm=forwardCmPerSec, turnDeg=0 |
| M2 | reverse | moveCm が負（=-reverseCmPerSec×sec） |
| M3 | rotateLeft | turnDeg 正（=+turnDegPerSec×sec）, moveCm=0 |
| M4 | rotateRight | turnDeg 負 |
| M5 | stop | {0,0} |
| M6 | dt 線形 | dt 2倍で moveCm/turnDeg 2倍 |
| M7 | 速度スケール | speed 半分（基準比）で量も半分 |
| M8 | 純粋性 | cmd/m を破壊しない |

### 5.2 `app/src/localization/pose-estimator.ts`（新規・純）
```ts
// pose-estimator.ts — 推測航法(dead-reckoning)。指令＋実dt で pose を1tick進める(純)。
// モデルベース: commandToDelta(校正) → integratePose(運動学カーネル)。ドリフトする=推定。
import type { Pose, Command, MotionModel } from "../types";
import { commandToDelta } from "./motion-model";
import { integratePose } from "../domain/kinematics";

export function estimateStep(pose: Pose, cmd: Command, dtMs: number, m: MotionModel): Pose {
    const { moveCm, turnDeg } = commandToDelta(cmd, dtMs, m);
    return integratePose(pose, moveCm, turnDeg);
}
```

**テスト仕様（`pose-estimator.test.ts`）**
| ID | ケース | 期待 |
|---|---|---|
| E1 | forward（yaw=0） | 向きへ前進（合成が正しい） |
| E2 | rotateLeft | yaw だけ増える |
| E3 | reverse | 後退 |
| E4 | stop | 不変 |
| E5 | dt 大 | 進む量が増える |
| E6 | **直進N tick** | 累積が N×1tick分（積分の健全性） |
| E7 | **正方形経路**（前進→正確に90度×4） | 始点付近へ戻る（メタモルフィック・誤差許容内）＝合成検証 |
| E8 | 純粋性 | 入力 pose 不変 |

---

## 6. Domain/App：記録（サンプル→集約→整形→保存）

### 6.1 `app/src/telemetry/session-meta.ts`（新規・純）
```ts
// sessionId/ヘッダ生成(純)。時刻は外から注入(テスト容易・new Date を内部で呼ばない)。
export function newSessionId(nowIso: string): string {
    return nowIso.replace(/[:.]/g, "-");           // "2026-06-28T12-00-00-000Z"
}
export function makeHeader(args: {...}): TrajectoryHeader { /* 値を詰めるだけ */ }
```
> **TDD ポイント**：時計（`Date`）を**内部で呼ばない**。`nowIso` を引数で受ける＝決定論的でテストできる（`session.test.ts` の「fake で注入」流儀を踏襲）。

### 6.2 `app/src/telemetry/sample.ts`（新規・純）
```ts
// makeSample — 観測(TickObservation)を TickSample に組むだけ(純)。pose は precision で丸める(config)。
// TickObservation/TickSample は types.ts に定義（入力=生観測 / 出力=ログ行）。
export function makeSample(o: TickObservation, precision: number): TickSample { ... }
```
**テスト**：S1 各フィールド対応／S2 `estimated` が source 由来／S3 pose 丸め桁が config 由来（ハードコーディングしない）／S4 純粋性。

### 6.3 `app/src/telemetry/trajectory.ts`（新規・純）
```ts
// createTrajectory — ヘッダ＋サンプル列の集約。append/size/snapshot のみ(整形は serialize へ分離)。
export function createTrajectory(header: TrajectoryHeader) { ... }  // {append, size, header, samples}
```
**テスト**：T1 空で開始／T2 append 順序保持／T3 size＝件数／T4 ヘッダ保持／T5 返す配列のスナップショット性（外から壊されない）。

### 6.4 `app/src/telemetry/serialize.ts`（新規・純）— 列定義は単一正本
```ts
// COLUMNS が CSV の唯一の正本。ヘッダ行と各行はここから生成→列ズレを構造的に防ぐ。
const COLUMNS = ["t","dt","cmdKind","speed","distanceCm","lifted","phase","x","y","yawDeg","estimated"] as const;
export function toNDJSON(traj): string { /* 1行目=header, 以降=tick。各行 JSON.stringify */ }
export function toCSV(traj): string { /* COLUMNS から header 行＋各 sample 行 */ }
```
**テスト仕様（`serialize.test.ts`）**
| ID | ケース | 期待 |
|---|---|---|
| N1 | NDJSON 1行目 | `type:"header"` の有効 JSON |
| N2 | NDJSON 以降 | 各行 `type:"tick"` の有効 JSON |
| N3 | 行数 | 1＋サンプル数（末尾改行の規約固定） |
| N4 | **往復同一**（round-trip） | 各行 `JSON.parse` → 元サンプルと一致（**取りこぼし無しの証明**） |
| C1 | CSV ヘッダ行 | `COLUMNS` と一致 |
| C2 | **列/セル数一致** | 各行のセル数＝`COLUMNS.length`（**列ズレ不変条件**＝フィールド追加漏れを検出） |
| C3 | 整形 | 数値/真偽の表現が規約どおり |
| C4 | 空 Trajectory | NDJSON=ヘッダ1行 / CSV=ヘッダ行のみ |

### 6.5 `app/src/telemetry/pose-source.ts`（新規）— 真値/推定の差し替え
```ts
// PoseSource — 「次の Pose をくれ」の抽象。recorder はこれにしか依存しない(依存逆転)。
/** @param dtMs 直前tickからの実経過[ms]（推定の積分に使う）。@returns Pose(x,y[cm]／yawDeg[度],0=+x・反時計+)。 */
export interface PoseSource { next(cmd: Command, dtMs: number): Pose; }

// sim: シムが知る真値を覗くだけ(推定しない・誤差ゼロ・cmd/dt 不要)。記録側 estimated=false。
export class SimPoseSource implements PoseSource {
    constructor(private sim: { getWorld(): { pose: Pose } }) {}
    next(): Pose { return this.sim.getWorld().pose; }
}
// 実機: エンコーダ無し→推測航法推定。記録側 estimated=true。pose を内部状態で持ち estimateStep で1tick進める(ドリフトする)。
export class EstimatorPoseSource implements PoseSource {
    constructor(private pose: Pose, private m: MotionModel) {}   // pose=初期姿勢 / m=校正(PWM→物理量)
    next(cmd: Command, dtMs: number): Pose { return (this.pose = estimateStep(this.pose, cmd, dtMs, this.m)); }
}
```
**テスト（`pose-source.test.ts`）**：SimPoseSource は fake sim の pose をそのまま返す／EstimatorPoseSource は呼ぶ度に進み、`cmd,dt` を estimateStep に渡す（連続呼び出しで累積）。

### 6.6 `app/src/telemetry/recorder.ts`（新規・App）— オーケストレーション
```ts
// TrajectoryRecorder — onTick を購読し sample 化して Trajectory に積む。
// 時計と PoseSource を注入＝実機/DOM 無しで完全にテストできる(session.test の fake 流儀)。
export class TrajectoryRecorder {
    constructor(private deps: {
        now: () => number;              // 注入(テストは fake clock)
        t0: number;
        poseSource: PoseSource;
        traj: ReturnType<typeof createTrajectory>;
        estimated: boolean;
        precision: number;
    }) {}
    private last = this.deps.t0;
    onTick(state: State, sensors: Sensors, cmd: Command): void {
        const now = this.deps.now();
        const dt = now - this.last; this.last = now;
        const pose = this.deps.poseSource.next(cmd, dt);
        this.deps.traj.append(makeSample({ t: now - this.deps.t0, dt, cmd, sensors, state, pose,
            estimated: this.deps.estimated }, this.deps.precision));
    }
    finish() { return this.deps.traj; }   // 停止後に serialize/download へ
}
```
**テスト仕様（`recorder.test.ts`／FakeClock＋FakePoseSource）**
| ID | ケース | 期待 |
|---|---|---|
| R1 | 初回 onTick | `t=now-t0`, `dt=now-t0`(初回), サンプル1件 |
| R2 | 2回目 | `dt`＝now差分, `t` 増加 |
| R3 | PoseSource 連携 | `next(cmd,dt)` が呼ばれ、返り pose が sample に入る |
| R4 | フラグ | `estimated` が伝播 |
| R5 | 連続 | 順序保持・件数一致 |
| R6 | finish | Trajectory を返す |

### 6.7 `app/src/telemetry/download.ts`（新規・Infra）
```ts
// 副作用(Blob/<a>.click)。純部分=ファイル名だけ切り出してテスト。
export function recordingFilename(sessionId: string, ext: "ndjson" | "csv"): string {
    return `trajectory-${sessionId}.${ext}`;
}
export function downloadText(filename: string, text: string, mime: string): void { /* DOM 副作用 */ }
```
**テスト**：`recordingFilename` の組み立てのみ（DOM 副作用は smoke）。

---

## 7. カメラ録画（Infrastructure）

### 7.1 決定的な前提（先に実機検証）
**ESP32 が stream を同時に何クライアントへ配れるか（おそらく1）** が設計を決める（[design-pose-trajectory-recording.md §2-1](../reference/design-pose-trajectory-recording.md)）。だから**プロキシで上流1本に集約**し、ブラウザ表示と ffmpeg 録画へ分配する＝同時数問題と CORS 汚染を同時に解く。

### 7.2 `tools/lib/mjpeg-demux.mjs`（新規・純）— ここが TDD の主戦場
multipart/x-mixed-replace の生バイトから JPEG フレーム（SOI `FF D8` … EOI `FF D9`）を切り出す。**チャンク分割で来る**ので状態を持つ純関数にする（これがバグの温床＝最重要のユニットテスト対象）。
```js
// extractFrames(state, chunk) -> { frames: Buffer[], state }
//   state.buf に未完成バイトを溜め、完成した JPEG だけ frames に出す。
export function extractFrames(state, chunk) { ... }
```
**テスト仕様（`mjpeg-demux.test.mjs`）**
| ID | ケース | 期待 |
|---|---|---|
| D1 | 完全1枚 | frames=1, 余り無し |
| D2 | 連結2枚 | frames=2 |
| D3 | EOI 未達 | frames=0, 余りに保持 |
| D4 | **2チャンクに分断** | 2個目投入後にフレーム出現（境界跨ぎに強い） |
| D5 | 先頭にmultipartヘッダ/ゴミ | SOI まで読み飛ばす |
| D6 | 連続ストリーム | 投入順＝出力順、バイト欠落なし（INV7） |

> **正直**：JPEG ペイロード内に `FF D9` 類似が出る可能性に備え、可能なら boundary 文字列も併用。合成テストで通したら、**実ストリームのキャプチャ1本でも検証**（§10 のギャップ参照）。

### 7.3 `tools/cam-proxy.mjs`（新規・Infra）— 配線（smoke 検証）
```
[ESP32 :81/stream] ─(上流1本)→ cam-proxy ─┬→ :8082/stream（<img>用・CORSヘッダ付与）
                                           └→ ffmpeg stdin → recordings/<sessionId>.mp4
```
- 上流 `http.get` 1本 → `extractFrames` で JPEG 抽出。
- 下流：各ブラウザへ multipart で再送（`Access-Control-Allow-Origin:*`）。
- 録画：JPEG を ffmpeg へ。`ffmpeg -f mjpeg -use_wallclock_as_timestamps 1 -i pipe:0 -c:v libx264 -pix_fmt yuv420p -movflags +faststart recordings/<sessionId>.mp4`（実時間どおりの再生速度）。
- 制御：`POST :8082/rec/start?session=<id>` / `/rec/stop`。サイドカー `recordings/<id>.json` に開始時刻。
- `tools/package.json` は依存追加不要（Node標準＋ffmpeg＝導入済み `/opt/homebrew/bin/ffmpeg`）。`ws-bridge.mjs` と並べて起動。

### 7.4 ブラウザ側（純＋薄い Infra）
- `camera/stream-url.ts`（純）：`cameraStreamUrl(recCfg)` = `useProxy?proxyUrl:directUrl`。**テスト**：U1 proxy／U2 direct／U3 config 由来。
- `camera/recorder-client.ts`（Infra）：`recStart(controlUrl, sessionId)`/`recStop()`（`fetch`）。**URL 組み立てだけ純関数に切り出してテスト**、`fetch` は smoke。

---

## 8. システムフロー（録画セッションの一気通貫）

```
[WiFi接続成功]
   └ session = { sessionId: newSessionId(nowIso), t0: now() }            (session-meta)
   └ cam.src = cameraStreamUrl(recCfg)  // プロキシ経由のライブ表示       (stream-url)

[「録画開始」]→ recStart(controlUrl, sessionId)  // proxy が ffmpeg 起動  (recorder-client)

[「開始」]→ runner.start()
   tick: read → step → send → onTick(state, sensors, cmd)
                                  └ recorder.onTick(...)                  (recorder)
                                       ├ pose = poseSource.next(cmd, dt)  (Sim=真値 / Estimator=推定)
                                       ├ traj.append(makeSample(...))     (sample/trajectory)
                                       └ draw(ctx, {pose}, sc, traj.trail) // 地図にトレイル (ui)
   ＝同時に proxy が recordings/<sessionId>.mp4 へ録画

[「停止」]→ emergencyStop()（既存）
   └ recStop()                                                            (recorder-client)
   └ text = toNDJSON(recorder.finish());  downloadText(recordingFilename(sessionId,"ndjson"), text) (serialize/download)
   ⇒ <sessionId>.mp4 と trajectory-<sessionId>.ndjson が同じ t0/時間軸で残る
```
- **sim モード**：`poseSource=SimPoseSource`（真値・`estimated:false`）。カメラ無し。
- **実機モード（USB/WiFi）**：`poseSource=EstimatorPoseSource`（推定・`estimated:true`）。カメラは WiFi のみ。
- `runner`/`cleaning` は**この図のどこにも変更が無い**（手足原則）。

---

## 9. 既定値（`app/src/config.ts`）— ハードコーディング集約

```ts
export const defaultMotionModel: MotionModel = {
    forwardCmPerSec: 22,    // driveSpeed(=80) の実速度。要実測(§10)。目標20〜30cm/s
    reverseCmPerSec: 20,
    turnDegPerSec: 90,    // turnSpeed(=100) の実角速度。要実測。目標60〜120°/s
    refDriveSpeed: 80,    // 上記を測った前進PWM(速度スケール基準＝現 driveSpeed)
    refTurnSpeed: 100,    // 旋回PWM(現 turnSpeed)
};
export const recordingConfig: RecordingConfig = {
    directUrl: "http://192.168.4.1:81/stream",
    proxyUrl:  "http://localhost:8082/stream",
    controlUrl:"http://localhost:8082",
    useProxy: true,
};
export const telemetryConfig: TelemetryConfig = {
    posePrecision: 1,     // 軌跡 pose の小数桁
};
```
> しきい値・URL・桁数を**すべて config に集約**。Domain は数値を直書きせず引数で受ける（`cleaning.ts` の `cfg` と同じ作法）。

---

## 10. テストは本当に足りるか（トレーサビリティと欠落の確認）

### 10.1 要求・不変条件 → テスト 追跡表
| ID | 要求/不変条件 | 担保するテスト | 種別 |
|---|---|---|---|
| Rq1 | sim は真値で軌跡 | pose-source(Sim)／recorder R3,R4 | unit |
| Rq2 | 実機は推定・`estimated=true` | pose-source(Estimator)／recorder R4／estimator E1-7 | unit |
| Rq3 | 毎tickを過不足なく記録 | recorder R1-R5 | unit |
| Rq4 | NDJSON/CSV で出せ往復可能 | serialize N1-N4, C1-C4 | unit |
| Rq5 | 軌跡をトレイル描画 | （描画＝smoke）＋sim 結合 | smoke/integ |
| Rq6 | mp4 に録画 | cam-proxy（smoke）／demux D1-D6 | smoke/unit |
| Rq7 | 上流1本＋ライブ維持＋CORS解決 | demux D6＋実機 §10.3 | smoke |
| Rq8 | 動画⇔軌跡を t0/sessionId で同期 | session-meta／header に videoFile | unit |
| Rq9 | ハードコーディング無し | sample S3（桁=config）／motion-model（数値=config） | unit |
| Rq10 | runner/cleaning 無改造 | 既存 cleaning.test が緑のまま | regression |
| INV1 | 全 Domain 関数が純粋 | K9, M8, E8, T5（入力不変） | unit |
| INV2 | シリアライズ往復同一 | N4 | unit |
| INV3 | CSV 列/セル数一致 | C2 | unit |
| INV4 | 推定の決定論性 | E6,E7（同入力→同出力） | unit |
| INV5 | dt 線形 | M6 | unit |
| INV6 | 記録順保持 | T2, R5 | unit |
| INV7 | MJPEG バイト無損失 | D4, D6 | unit |
| INV8 | モデル単一正本（advance＝カーネル＋clamp） | 既存 model.test 緑＋K1-K8 | regression |

### 10.2 「これで十分」と言える根拠（網羅の論拠）
- **分岐網羅**：純関数（kinematics/motion-model/estimator/serialize）は `switch`/分岐が少数で**全枝に対応テストがある**（K/M/E/N/C で全 case 到達）。Domain は**行カバレッジ100%を目標**（純で安いので妥当）。
- **境界値**：`dt=0`（初回・R1）／`speed=0`（M5 stop）／`speed=255`（K1）／空 Trajectory（C4）／単一サンプル／yaw=0/90/180/負（K1-K4）／チャンク分断（D4）。
- **不変条件をテスト化**：純粋性・往復同一・列セル一致・無損失を「性質テスト」として固定（リグレッションに強い）。
- **メタモルフィック**：dt 2倍→量2倍（M6）、正方形経路→原点近傍（E7）で**合成の正しさ**を確認（個別 case では漏れる積分バグを捕捉）。
- **オーケストレーションも単体可**：recorder は clock/PoseSource を**注入**するので実機/DOM 無しで R1-R6 が回る（`session.test.ts` の fake 流儀）。

### 10.3 ユニットでは“足りない”領域（正直に・代替手段で埋める）
| 欠落 | なぜ単体で不可 | どう埋めるか |
|---|---|---|
| 実機の dt ジッタ／推定ドリフト量 | 物理・電圧・スリップ依存 | §11 校正＋「推定」明示＋sim 結合で“形”を確認。**精度は保証しない** |
| **ESP32 同時 stream 数** | ハード仕様（未確認） | **2タブ同時表示で実測**→1ならプロキシ必須/録画専用に分岐 |
| ffmpeg の実エンコード | 外部プロセス | smoke：生成 mp4 が再生でき・実時間長か |
| MJPEG 実フォーマットの差異 | 実機固有 | demux を**実キャプチャ1本**で検証（合成D1-D6に加える） |
| canvas/MediaRecorder の CORS 汚染（R1採用時） | ブラウザ＋オリジン依存 | プロキシ(localhost)経由で汚染回避を spike 確認 |
| download/proxy/main の配線 | DOM/ネット副作用 | 純部分だけ抽出テスト（filename/URL）＋ smoke チェックリスト |

> **結論**：**ロジック（Domain/App）はテストで十分**（全枝＋境界＋不変条件＋合成）。残るリスクは**ハード/IO の本質的に単体化できない部分**で、これは §11 の smoke チェックリストと「未確認(§12)」で明示的に潰す。「テストが緑＝動く」ではなく「テストが緑＝**ロジックは正しい**、ハードは smoke で別途確認」と切り分ける。

---

## 11. 実装順序（TDD：red→green→refactor、依存順）と DoD

依存の下流から積む。各ステップ「**テストを書く→赤→実装→緑→必要ならリファクタ**」。
1. `kinematics`（K）→ 緑 → **`advance` を委譲にリファクタ**（既存 model.test 緑を確認＝INV8）。
2. `motion-model`（M）→ `pose-estimator`（E）。
3. `session-meta`／`sample`／`trajectory`（T）／`serialize`（N,C）。
4. `pose-source`／`recorder`（R）。
5. `download`（filename のみテスト）／`stream-url`（U）／`recorder-client`（URLのみ）。
6. `tools/lib/mjpeg-demux`（D）→ `tools/cam-proxy.mjs`（配線）。
7. `config`/`types`/`ui`(トレイル)/`main` 配線 → **sim 結合**（下記）。

**Definition of Done（ゲート）**
- [ ] `npm run test:run` 緑（新規ユニット全部）＋ `npm run typecheck` 緑。
- [ ] **sim 結合**：自走させ「**空でない Trajectory が NDJSON で出て往復一致**」「地図にトレイルが描かれる」。
- [ ] **実機 smoke**（WiFi）：`ffmpeg -i <stream>` で mp4 が再生できる／2タブ同時可否を実測／録画＋自走で `mp4` と `ndjson` が同 `sessionId` で残り、軌跡の“形”が走行と矛盾しない。
- [ ] Domain 行カバレッジ ≒100%（純モジュール）。

---

## 12. リスク・未確認（実機で潰す）
- **ESP32 同時 stream 数**（=録画方式の分岐点。おそらく1）。2タブで実測。
- **推定ドリフト**：エンコーダ無し＝戻ってもループは閉じない。UI/ログで「推定」明示は必須。
- **dt の実測**：WiFi は往復で tick が伸びる（[serial-robot §read コメント](../../app/src/io/serial-robot.ts)）。**名目 tickMs でなく実測 dt**（recorder で `now()` 差分）を使う。
- **MJPEG demux の実フォーマット差**：合成テスト＋実キャプチャ検証。境界文字列併用を検討。
- **ffmpeg 連結JPEG（`-f mjpeg pipe:0`）の安定性**・長時間録画時の ESP32 帯域/発熱/電池。
- **校正値**（`forwardCmPerSec`/`turnDegPerSec`）は満充電で実測。電圧低下で速度・角速度が落ちる前提。

---

## 13. 実装後にやること
- [current-build-spec.md](../reference/current-build-spec.md) を更新（§5 カメラ＝録画可、§9 穴＝軌跡を「推定で記録可」へ）。
- [design-pose-trajectory-recording.md](../reference/design-pose-trajectory-recording.md) の②③に done 印。①（IMU yaw / 俯瞰ArUco の精密自己位置）は将来段階へ。

---
関連：[design-pose-trajectory-recording.md](../reference/design-pose-trajectory-recording.md)（構想・方式比較）／ [code-design.md](code-design.md)（層分け・onTick・手足原則）／ [stage6-scan-and-reverse.md](stage6-scan-and-reverse.md)（直近の状態・サーボ/後退）／ [stage5-wireless-camera.md](stage5-wireless-camera.md)（カメラ/Node中継）／ [current-build-spec.md](../reference/current-build-spec.md)（現状）／ [machine-reference.md](../reference/machine-reference.md) §9（プロトコル）
</content>
</invoke>
</invoke>
