# 段階9：main.ts 単一責務化 — 記録ライフサイクルを `RecordingSession` へ抽出（リファクタ・TDD）

> **ゴール**：[7d](stage7d-recorder-and-ui.md) で `main.ts` に積み上がった記録の方針（状態＋寿命＋保存）を、注入でテスト可能な `RecordingSession`（`createRecordingSession` factory） に隔離し、`main.ts` を痩せた composition root（部品を組んで繋ぐだけ）へ戻す。**振る舞いは不変**（sim/実機の自走でトレイルが出る・NDJSON/CSV が落ちる）。
> **なぜ**：`main.ts` が「配線（正業）」を超えて「**記録の状態を持つロジック**」まで抱え、DOM に縛られて**ユニット不能**になっている（7d §7.2 で smoke 送り）。接続を `RobotSession` に隔離したのと**同じ発想**を記録にも打ち、テスト可能面を広げる（[code-design.md](code-design.md) §2 SRP・依存逆転）。
> **前提**：[7d](stage7d-recorder-and-ui.md) 完了（`telemetry/` 一式・`config.ts` の `defaultMotionModel`/`telemetryConfig` が在る）。`runner.ts`/`domain/cleaning.ts`/`telemetry` 各純モジュールは**無改造**。
> **このstageの位置**：…→ [7d](stage7d-recorder-and-ui.md)（記録機能）→ [8: カメラ録画（予約）](../reference/design-trajectory-recording-architecture.md) → **9（本書：main 単一責務化）**。8 とは独立（順不同可）。

---

## 0. この回の増分

| # | 増分 | ファイル | テスト |
|---|---|---|---|
| 1 | `createRecordingSession`（start/tick/active/save、依存注入） | `telemetry/recording-session.ts` | **先に**（fake clock/nowIso/download/PoseSource） |
| 2 | `main.ts` を composition root へ（記録状態を撤去し session へ委譲） | `main.ts` | 副作用＝smoke |
| 3 | `code-design.md` のファイル表に責務を追記 | `docs/project/code-design.md` | — |

> **なぜ 7d に混ぜず別stageか**：7d は**機能を通す**回、9 は**構造を整える**回。1stage=1関心・小さく読めるdiffに保つ。7d で記録を最短で動かし、その振る舞いを安全網（既存テスト＋本stageの新ユニット）に守らせてから main を解体する。

> **責務の線引き（このstageの肝）**：
> - **`RecordingSession`＝記録セッションの「状態・寿命・直列化」**。`now`/`nowIso`/`download` を**注入**するので DOM/実 `Date` 無しでユニットテスト可。
> - **`main.ts`＝合成点**。具象（`simRobot`/`session`）を知る唯一の場所として **`poseSource` の選択（sim 真値 / 実機 推定）と `draw`（canvas）だけ**を持つ。
> - `poseSource` の選択を session 側に入れない理由：それは `simRobot`/`session` という具象を要求し、DOM/sim に依存してテスト不能になる。**具象は main、方針は session**＝依存逆転を守る。

> **なぜ class でなく factory か**：このメソッドは `onTick` やボタンの**コールバックとして渡される**（`addEventListener("click", recording.saveNDJSON)`）。class だと `this` が外れて壊れるため bind/矢印で包む必要が出る。**クロージャを返す factory なら `this` 不要でそのまま渡せる**。さらに同レイヤの `createTrajectory`/`createRunner` と idiom が揃い、状態はクロージャで**実行時も真に private**。`RobotSession` が class なのは「`session.connect(...)` と直接呼ぶ」用途だから——こちらは「渡す」用途なので idiom を分ける理由がある。

---

## 1. 増分1：`createRecordingSession`（注入でテスト可能に隔離）

### ① テストを先に書く（RED）
`app/src/telemetry/recording-session.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { createRecordingSession } from "./recording-session";   // ← まだ無い。RED
import type { PoseSource } from "./pose-source";
import type { Pose, State, Sensors, Command, Config, MotionModel } from "../types";

// 注入する fake 群（DOM も時計も実 Date も使わない＝決定論的）
class FakePoseSource implements PoseSource {
    private i = 0;
    constructor(private poses: Pose[]) {}
    next(): Pose { return this.poses[this.i++]; }
}
const clock = (ts: number[]) => { let i = 0; return () => ts[i++]; };   // 時刻を台本で渡す

const cfg = { wallCm: 20 } as unknown as Config;       // ヘッダ素通しなので中身は問わない
const mm: MotionModel = { forwardCmPerSec: 20, reverseCmPerSec: 20, turnDegPerSec: 90, refDriveSpeed: 80, refTurnSpeed: 100 };
const sensors: Sensors = { distanceCm: 48, yawDeg: 0, lifted: false };
const state = { phase: "drive" } as State;             // makeSample が読むのは phase だけ
const fwd: Command = { kind: "forward", speed: 80 };
const pose0: Pose = { x: 0, y: 0, yawDeg: 0 };

function setup(times: number[], poses: Pose[]) {
    const saved: { filename: string; text: string; mime: string }[] = [];
    const rec = createRecordingSession({
        now: clock(times),
        nowIso: () => "2026-06-28T12:00:00.000Z",       // 固定（session-meta と同じ「時計は注入」流儀）
        precision: 1,
        config: cfg,
        download: (filename, text, mime) => saved.push({ filename, text, mime }),
    });
    const start = (recordVideo = false) => rec.start({ poseSource: new FakePoseSource(poses), estimated: true, source: "wifi", motionModel: mm, pose0, recordVideo });
    return { rec, saved, start };
}

describe("createRecordingSession", () => {
    it("start 前: tick は null・active=false（＝描かない）", () => {
        const { rec } = setup([], []);
        expect(rec.active).toBe(false);
        expect(rec.tick(state, sensors, fwd)).toBeNull();
    });

    it("start→tick: 軌跡(pose列)を返し active=true", () => {
        const { rec, start } = setup([1000, 1100], [{ x: 1, y: 0, yawDeg: 0 }]);
        start();
        expect(rec.active).toBe(true);
        expect(rec.tick(state, sensors, fwd)).toEqual([{ x: 1, y: 0, yawDeg: 0 }]);
    });

    it("複数 tick で軌跡が累積する", () => {
        const { rec, start } = setup([1000, 1100, 1200], [{ x: 1, y: 0, yawDeg: 0 }, { x: 2, y: 0, yawDeg: 0 }]);
        start();
        rec.tick(state, sensors, fwd);
        const trail = rec.tick(state, sensors, fwd);
        expect(trail).toHaveLength(2);
        expect(trail![1]).toEqual({ x: 2, y: 0, yawDeg: 0 });
    });

    it("saveNDJSON: 注入 download に (ファイル名, NDJSON, mime) を渡す・往復可能", () => {
        const { rec, saved, start } = setup([1000, 1100], [{ x: 1, y: 0, yawDeg: 0 }]);
        start();
        rec.tick(state, sensors, fwd);
        rec.saveNDJSON();
        expect(saved).toHaveLength(1);
        expect(saved[0].filename).toContain("2026-06-28T12-00-00-000Z");   // newSessionId 由来(: . → -)
        expect(saved[0].filename).toMatch(/\.ndjson$/);
        expect(saved[0].mime).toBe("application/x-ndjson");
        const lines = saved[0].text.trim().split("\n").map((l) => JSON.parse(l));
        expect(lines[0].type).toBe("header");
        expect(lines).toHaveLength(2);                                     // header + 1 tick
    });

    it("recordVideo:true → ヘッダ videoFile=<sessionId>.mp4／sessionId を公開（stage8 同期）", () => {
        const { rec, saved, start } = setup([1000, 1100], [{ x: 1, y: 0, yawDeg: 0 }]);
        start(true);
        rec.tick(state, sensors, fwd);
        rec.saveNDJSON();
        const header = JSON.parse(saved[0].text.trim().split("\n")[0]);    // 先頭=ヘッダ行
        expect(rec.sessionId).toBe("2026-06-28T12-00-00-000Z");            // カメラ録画に渡す id
        expect(header.videoFile).toBe("2026-06-28T12-00-00-000Z.mp4");     // 軌跡⇔動画の紐付け
    });

    it("save 前(未開始)は download を呼ばない（ガード）", () => {
        const { rec, saved } = setup([], []);
        rec.saveNDJSON();
        rec.saveCSV();
        expect(saved).toHaveLength(0);
    });

    it("this 非依存: メソッドを裸で渡しても動く（コールバック用途）", () => {
        const { rec, saved, start } = setup([1000, 1100], [{ x: 1, y: 0, yawDeg: 0 }]);
        start();
        rec.tick(state, sensors, fwd);
        const handler = rec.saveNDJSON;          // ★レシーバから外して渡す
        handler();
        expect(saved).toHaveLength(1);           // class なら this 外れて壊れる。factory は通る
    });

    it("再 start で前の記録を畳んで差し替える（新規 traj・空から積む）", () => {
        const { rec, start } = setup([1000, 1100, 2000, 2100], [{ x: 1, y: 0, yawDeg: 0 }, { x: 9, y: 9, yawDeg: 0 }]);
        start(); rec.tick(state, sensors, fwd);
        start();                                 // ★やり直し
        expect(rec.tick(state, sensors, fwd)).toHaveLength(1);            // 新記録は空から
    });
});
```
→ `npm run test:run`：**赤**。

### ② 最小実装でGREEN
`app/src/telemetry/recording-session.ts`
```ts
// recording-session.ts — 記録セッションの寿命・状態・直列化を1単位に閉じる(注入でテスト可)。
// 不変条件: 同時に生きる記録は最大1つ。start で前を畳んで新規へ差し替える(RobotSession と同じ作法)。
import type { Pose, State, Sensors, Command, Config, MotionModel, TrajectoryHeader } from "../types";
import type { PoseSource } from "./pose-source";
import { createTrajectory } from "./trajectory";
import type { Trajectory } from "./trajectory";
import { TrajectoryRecorder } from "./recorder";
import { newSessionId, makeHeader } from "./session-meta";
import { toNDJSON, toCSV } from "./serialize";
import { recordingFilename } from "./download";

/** 副作用と時計は注入＝DOM/実 Date 無しでテストできる。 */
export type RecordingDeps = {
    now: () => number;                                              // 時計[ms]（recorder の dt 計測にも使う）
    nowIso: () => string;                                           // ISO 時刻（内部で Date を呼ばない）
    precision: number;                                              // pose 丸め桁（config 由来）
    config: Config;                                                 // ヘッダに残す実行時 config
    download: (filename: string, text: string, mime: string) => void;  // 保存の副作用
};

/** 記録開始時の「その回固有」の文脈。具象選択(sim/実機)は合成点 main が決めて渡す。 */
export type StartArgs = {
    poseSource: PoseSource;                                         // 真値(Sim) or 推定(Estimator)
    estimated: boolean;                                             // sim=false / 実機=true
    source: TrajectoryHeader["source"];                            // "sim" | "usb" | "wifi"（ヘッダ用ラベル）
    motionModel: MotionModel;                                       // ヘッダに残す校正
    pose0: Pose;                                                    // 開始姿勢
    recordVideo?: boolean;                                          // 動画も録るか（stage8 同期。既定 false）
};

export function createRecordingSession(d: RecordingDeps) {
    let recorder: TrajectoryRecorder | null = null;                // ← クロージャで真に private
    let traj: Trajectory | null = null;
    let id = "";

    function save(ext: "ndjson" | "csv", to: (t: Trajectory) => string, mime: string): void {
        if (!recorder) return;                                     // 未開始は何もしない(ガード)
        d.download(recordingFilename(id, ext), to(recorder.finish()), mime);
    }

    return {
        /** 記録中か(描画分岐・保存ボタン活性に使える)。 */
        get active(): boolean { return recorder !== null; },

        /** 発行した sessionId（カメラ録画を同じ id で起動・動画名導出に使う＝stage8 同期）。 */
        get sessionId(): string { return id; },

        /** 記録を開始(前があれば破棄して差し替え)。以後 tick が積む。 */
        start(a: StartArgs): void {
            const startedAtIso = d.nowIso();
            id = newSessionId(startedAtIso);
            const t0 = d.now();
            const videoFile = a.recordVideo ? `${id}.mp4` : null;   // 動画名は id から導出(Node の videoFilename と一致)
            traj = createTrajectory(makeHeader({
                sessionId: id, startedAtIso, source: a.source, videoFile,
                config: d.config, motionModel: a.motionModel, pose0: a.pose0,
            }));
            recorder = new TrajectoryRecorder({
                now: d.now, t0, poseSource: a.poseSource, traj,
                estimated: a.estimated, precision: d.precision,
            });
        },

        /** 1tick 記録し、描画用の軌跡(pose列)を返す。未開始なら null(=描かない)。 */
        tick(state: State, sensors: Sensors, cmd: Command): Pose[] | null {
            if (!recorder || !traj) return null;
            recorder.onTick(state, sensors, cmd);
            return traj.samples().map((s) => s.pose);
        },

        saveNDJSON(): void { save("ndjson", toNDJSON, "application/x-ndjson"); },
        saveCSV(): void { save("csv", toCSV, "text/csv"); },
    };
}

/** 公開型は実装から導出（手書き interface を二重管理しない）。 */
export type RecordingSession = ReturnType<typeof createRecordingSession>;
```
→ 緑。**ロジック＝寿命管理＋委譲だけ**。`session-meta`/`recorder`/`serialize`/`download` は 7c/7d で個別にテスト済みなので、ここは**配線とライフサイクル（開始/差し替え/ガード/保存）**に集中する。`save` を `this` でなくクロージャ関数にしているので、`saveNDJSON`/`saveCSV` は**裸で渡しても動く**。

---

## 2. 増分2：`main.ts` を composition root へ戻す（smoke）

記録の**状態と方針を session へ移し**、main からは撤去する。残すのは「具象を組んで渡す」配線だけ。以下が **stage9 後の `main.ts` 全文**。

```ts
// main.ts — シムデモ＋実機自走の組み立て。部品を繋ぎ、ボタンに配線する。
import {
    defaultConfig,
    initialState,
    WS_URL,
    CAM_URL,
    defaultMotionModel,
    telemetryConfig,
} from "./config";
import { defaultSimConfig } from "./sim/model";
import type { World } from "./sim/model";
import type { Transport } from "./io/transport";
import type { State, Sensors, Command, TrajectoryHeader } from "./types";
import { SimRobot } from "./sim/sim-robot";
import { createRunner } from "./runner";
import { draw } from "./ui";
import { SerialTransport } from "./io/transport";
import { WebSocketTransport } from "./io/ws-transport";
import { RobotSession } from "./session";
import { createRecordingSession } from "./telemetry/recording-session";        // ★stage9: 記録の所有者
import { SimPoseSource, EstimatorPoseSource } from "./telemetry/pose-source";  // ★main は具象を選ぶだけ
import { downloadText } from "./telemetry/download";                          // ★保存の副作用を注入
// （createTrajectory / TrajectoryRecorder / session-meta / serialize の直接 import は main から消えた）

const canvas = document.querySelector<HTMLCanvasElement>("#sim")!;
const ctx = canvas.getContext("2d")!;

// 左寄り・右向きで開始(部屋の中で適当な初期姿勢)
const initialWorld: World = {
    pose: { x: 20, y: defaultSimConfig.roomH / 2, yawDeg: 0 },
    servoDeg: defaultConfig.scanCenterDeg,
};
const simRobot = new SimRobot(initialWorld, defaultSimConfig);

// 接続種別ラベル（接続成功時に usb/wifi へ。接続の関心なので main に残す）
let connSource: TrajectoryHeader["source"] = "sim";

// 副作用・時計・config を「ここ(合成点)」で1度だけ束ねて session に注入する。
const recording = createRecordingSession({
    now: Date.now,
    nowIso: () => new Date().toISOString(),
    precision: telemetryConfig.posePrecision,
    config: defaultConfig,
    download: downloadText,
});

// 記録中なら session に積ませ、返った軌跡をトレイル描画。未記録なら従来どおり描くだけ。
// truth: シムは真値 world を渡す／実機は無いので、返った推定 pose 末尾から world を組む。
function render(state: State, sensors: Sensors, cmd: Command, truth?: World): void {
    const trail = recording.tick(state, sensors, cmd);
    if (trail) {
        const world = truth ?? { pose: trail[trail.length - 1], servoDeg: defaultConfig.scanCenterDeg };
        draw(ctx, world, defaultSimConfig, trail);    // ※stage11 で第5引数 sensors.distanceCm を追加
    } else if (truth) {
        draw(ctx, truth, defaultSimConfig);
    }
}

const simRunner = createRunner(simRobot, defaultConfig, initialState, (state, sensors, cmd) => {
    render(state, sensors, cmd, simRobot.getWorld());   // sim=真値 world ＋(記録中なら)トレイル
});
draw(ctx, simRobot.getWorld(), defaultSimConfig);       // 初期状態を1回描く

// --- 実機(自走)。接続できたらここに入る ---
const session = new RobotSession();

// 緊急停止: ループを止め、実機に stop を複数回送る(25m USB で1フレーム落ちても止まるように)
async function emergencyStop(): Promise<void> {
    simRunner.stop();
    session.runner?.stop();
    for (let i = 0; i < 3; i++) {
        await session.robot?.send({ kind: "stop", speed: 0 }).catch(() => {});
    }
    console.log("■ 停止");
}

// 開始：具象(sim/実機)の選択は main が行い、session に渡す。
document.querySelector("#start")!.addEventListener("click", () => {
    const isReal = !!session.runner;
    const pose0 = simRobot.getWorld().pose;
    recording.start({
        poseSource: isReal ? new EstimatorPoseSource(pose0, defaultMotionModel) : new SimPoseSource(simRobot),
        estimated: isReal,
        source: isReal ? connSource : "sim",
        motionModel: defaultMotionModel,
        pose0,
        // （カメラ録画は stage8c で recordVideo: recordingConfig.useProxy を足す＝動画⇔軌跡を同じ sessionId で対に）
    });
    (session.runner ?? simRunner).start();          // 実機接続済みなら実機、未接続なら sim
});

// 停止: 緊急停止(stopを複数回送る)。ボタンもキー(Esc/Space)と同じ確実な停止にする。
document.querySelector("#stop")!.addEventListener("click", () => { void emergencyStop(); });

// キーボードでも緊急停止(Esc / Space)。暴走時の保険。
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === " ") { e.preventDefault(); void emergencyStop(); }
});

// 保存：factory なので this 不要＝ハンドラを裸で渡せる。
document.querySelector("#save-ndjson")!.addEventListener("click", recording.saveNDJSON);
document.querySelector("#save-csv")!.addEventListener("click", recording.saveCSV);

const connectBtn = document.querySelector<HTMLButtonElement>("#connect")!;
const wifiBtn = document.querySelector<HTMLButtonElement>("#connect-wifi")!;

// USB/WiFi 共通の接続処理。Transport の開け方だけ差し替え、あとは session に委ねる。
// session.connect が「旧を stop→close してから新を張る」ので、二重接続=ゾンビ runner が生まれない。
async function connect(openTransport: () => Promise<Transport>, okMsg: string, source: TrajectoryHeader["source"]): Promise<boolean> {
    connectBtn.disabled = wifiBtn.disabled = true;      // open 中は多重クリック不可
    try {
        await session.connect(openTransport, (robot) => createRunner(
            robot, defaultConfig, initialState, (state, sensors, cmd) => {
                // 壁検知が効いているか見えるよう、距離・相・指令をログ
                console.log(`[tick] dist=${sensors.distanceCm}cm phase=${state.phase} left=${state.turnTicksLeft} cmd=${cmd.kind}`);
                render(state, sensors, cmd);            // 記録＋推定トレイル描画(実機は truth 無し)
            }
        ));
        await session.robot?.send({ kind: "stop", speed: 0, aimDeg: defaultConfig.scanCenterDeg });
        connSource = source;                            // ヘッダ source 用に接続種別を保持
        console.log(okMsg);
        return true;
    } catch (e) {
        console.warn("接続失敗:", (e as Error).message);   // 失敗=未接続(安全側)。シムは使える
        return false;
    } finally {
        connectBtn.disabled = wifiBtn.disabled = false;   // 失敗でも再挑戦できるよう必ず戻す
    }
}

// USB接続: ユーザー操作内で requestPort が要るので click ハンドラ直下で開く。
connectBtn.addEventListener("click", () => {
    void connect(() => SerialTransport.open(), "実機接続OK。『開始』で自走、『停止』/Esc/Spaceで停止。", "usb");
});

// WiFi接続: WS中継経由でつなぐ。USB と違うのは Transport の開け方とカメラ表示だけ。
wifiBtn.addEventListener("click", async () => {
    const ok = await connect(() => WebSocketTransport.open(WS_URL), "WiFi接続OK。『開始』で自走、『停止』/Esc/Spaceで停止。", "wifi");
    if (ok) {
        const cam = document.querySelector<HTMLImageElement>("#cam");
        if (cam) cam.src = CAM_URL;     // カメラはWiFi接続成功時だけ表示
    }
});
```

- **main から消えたもの**：`recorder`/`recTraj`/`recId` の module 状態、`beginRecording`、`createTrajectory`/`makeHeader`/`TrajectoryRecorder`/`toNDJSON`/`toCSV` の直接利用。
- **main に残る正業**：`poseSource` の選択（具象）、`draw`、DOM/ボタン配線、`connSource`（接続ラベル）、緊急停止・接続。
- `recorder`/`serialize`/`session-meta`/`trajectory` は `recording-session.ts` の内側に隠れた（main は `recording` 1個にだけ依存）。

> **smoke（DoD）**：sim 自走でトレイルが出る／NDJSON・CSV をDLし**開けて往復一致**／実機（USB/WiFi）でも軌跡が落ちる。挙動は 7d と不変。

---

## 3. 増分3：`code-design.md` のファイル表に追記
[code-design.md](code-design.md) §3 の責務表へ1行：

| ファイル | 単一責務 | 純粋? | テスト |
|---|---|---|---|
| `telemetry/recording-session.ts` | 記録セッションの**寿命・状態・直列化を束ねるだけ**（now/download 注入・factory） | ✗（注入で隔離） | ✓ |

依存図には `main ──▶ recording-session ──▶ recorder/serialize/…`、`main ──▶ pose-source`（具象選択）を追記。

---

## 4. テストは足りるか（十分性チェック）

| 観点 | 確認 |
|---|---|
| **ライフサイクル** | start 前(null/active=false)／start→tick(列を返す)／複数 tick 累積／再 start 差し替え＝寿命の全分岐。 |
| **ガード** | 未開始での save が download を呼ばない（NDJSON/CSV 両方）。 |
| **直列化の結線** | saveNDJSON が download に正しい (ファイル名・mime・本文) を渡し、本文が**往復可能**（header+tick 行）。 |
| **stage8 前方互換** | `recordVideo:true` で header.videoFile=`<sessionId>.mp4`／`sessionId` 公開（カメラを同じ id で起動可能）。 |
| **this 非依存** | メソッドを裸で渡しても動く（コールバック用途の保証＝factory にした目的のテスト）。 |
| **注入の純粋性** | `now`/`nowIso`/`download` はすべて fake＝**実 Date も DOM も踏まない**。sessionId が `nowIso` 由来（`: . → -`）で内部時計を呼んでいないと分かる。 |
| **委譲先は二重テストしない** | `recorder`/`serialize`/`session-meta`/`download` は 7c/7d で済み。ここは配線のみ検証。 |
| **ユニット不能・別手段** | `main` の `draw`(canvas)・DOM 配線・`downloadText` 実体は副作用＝**smoke**（7d §7.2 と同じ）。ただし**記録の方針は session に出たのでユニット化済み**＝smoke 面が縮む。 |

**結論**：記録ロジックは「ライフサイクル分岐＋ガード＋直列化結線＋this非依存＋注入純粋性」で十分。`main` に残るのは合成と描画という**本質的に非ユニットの薄い層**だけになり、これは smoke で閉じる。

---

## 5. Definition of Done（stage9 のゲート）
- [ ] `npm run test:run` 緑（既存＋`recording-session.test.ts`）／`npm run typecheck` 緑。
- [ ] `main.ts` に `recorder`/`recTraj`/`recId` の状態と `makeHeader`/`createTrajectory` 直接利用が**残っていない**（記録の方針は `recording-session.ts` に在る）。
- [ ] **挙動不変**：sim/実機の自走で**トレイル表示**・**NDJSON/CSV DL＆往復一致**（7d と同じ smoke が通る）。
- [ ] `code-design.md` §3 に `recording-session.ts` の責務行を追記。

> **次の候補（別stage・任意）**：`emergencyStop` / `connect` のオーケストレーションも main から `RobotSession` 側 or 小さなハンドラへ寄せる。カメラ録画（stage8）が main に配線を足す場合、同じ要領で `createCameraSession` に隔離して main を薄く保つ。

---

## 6. メモ：全クラス監査（class→関数化は他に要るか）

本stageついでに全クラス(8個)を「**多態(`implements`)か／メソッドを裸でコールバック渡しするか(`this`脆弱)**」で点検した。**関数化が要るのは `RecordingSession` だけ**（保存メソッドを `addEventListener` に裸渡しするため）。他は全て **`obj.method()` の直呼び**で `this` 事故が無く、大半は多態で依存逆転を担うので **class が正解**。

| クラス | 多態 | 裸渡し | 判定 |
|---|---|---|---|
| `SimPoseSource`/`EstimatorPoseSource`（`PoseSource`） | ✅ | ❌ | class 維持（依存逆転） |
| `SerialRobot`/`SimRobot`（`RobotIO`） | ✅ | ❌ | class 維持 |
| `SerialTransport`/`WebSocketTransport`（`Transport`） | ✅ | ❌ | class 維持（`private ctor`＋`static open()`） |
| `RobotSession` | ❌ | ❌ | class 維持（直呼びの寿命所有者） |
| `TrajectoryRecorder` | ❌ | ❌ | class でOK（唯一の任意候補。`telemetry/` の idiom 統一をするなら `createRecorder` も可、機能的理由は無し） |

**基準**：真の判断軸は「class か否か」ではなく「**メソッドをコールバックで渡すか**」。裸渡し＝factory、直呼び＝class。多態クラスを関数化すると `implements`（差し替え可能の意図表明）が消える＝改善でなく劣化なので触らない。

---
関連：[stage7d](stage7d-recorder-and-ui.md)（記録機能・このリファクタの対象）／ [code-design.md](code-design.md)（§2 SRP・依存逆転／§3 ファイル責務表）／ [session.ts](../../app/src/session.ts)（`RobotSession`＝同型の隔離・注入テストの前例）／ [design-trajectory-recording-architecture.md](../reference/design-trajectory-recording-architecture.md)（全体・stage8 カメラ）
