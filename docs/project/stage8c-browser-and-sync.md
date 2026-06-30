# 段階8c：ブラウザ結線と軌跡同期（仕上げ）— TDD＋smoke

> **ゴール**：プロキシ（[8b](stage8b-recording-pipeline.md)）をブラウザに繋ぎ、**①ライブ表示をプロキシ経由に切替（CORS解決・上流1本）②録画開始/停止ボタン ③stage7 の軌跡ログと同期**（同じ `sessionId`/`t0`、`TrajectoryHeader.videoFile` に動画名）まで通す。
> **設計の肝**：ブラウザ側も**URL の判断は純関数**（`stream-url` / `control-url`）に切り出して Vitest で固定し、`fetch`・`main` 配線・`<img>` は smoke。**カメラは UNO/Serial 経路と無関係な独立チャネル**（[code-design §6.1](code-design.md)）なので `protocol`/`runner`/`cleaning` は無改造。
> **前提**：[8a](stage8a-mjpeg-demux.md)/[8b](stage8b-recording-pipeline.md)、**stage7d**（`TrajectoryHeader.videoFile`/recorder）、および **[stage9](stage9-main-single-responsibility.md)**（記録は `recording`＝`createRecordingSession` が所有。`recording.sessionId` 公開・`recordVideo` 受け取り）。stage6 適用後でも**カメラの型・コードに影響なし**（負荷の話は §6）。
> **このstageの位置**：[8a](stage8a-mjpeg-demux.md) → [8b](stage8b-recording-pipeline.md) → 8c(本書)。

---

## 0. この回の増分

| # | 増分 | ファイル | テスト |
|---|---|---|---|
| 1 | `RecordingConfig` 型 | `types.ts` | — |
| 2 | `cameraStreamUrl`（proxy/direct 選択） | `camera/stream-url.ts` | **先に**（vitest） |
| 3 | `recControlUrl`（録画制御URL組立） | `camera/control-url.ts` | **先に**（vitest） |
| 4 | `recStart`/`recStop`（fetch） | `camera/recorder-client.ts` | URL は純で担保・fetch は smoke |
| 5 | `recordingConfig`（値の集約） | `config.ts` | — |
| 6 | `main` 配線＋**stage7 同期**（videoFile） | `main.ts` | 副作用＝smoke（DoD） |

---

## 1. 増分1：`RecordingConfig` 型（`types.ts`）

```ts
/** カメラ録画/ライブ表示の設定（値は config.ts に集約＝ハードコーディングしない）。 */
export type RecordingConfig = {
    directStreamUrl: string;   // ESP32 直 MJPEG（http://192.168.4.1:81/stream）
    proxyStreamUrl: string;    // プロキシ経由（http://localhost:8082/stream）
    controlUrl: string;        // 録画制御（http://localhost:8082）
    useProxy: boolean;         // true=プロキシ経由（録画・CORS解決） / false=直URL
};
```

## 2. 増分2：`cameraStreamUrl`（ライブ表示URLの選択）

**① テスト（RED）** `app/src/camera/stream-url.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { cameraStreamUrl } from "./stream-url";
import type { RecordingConfig } from "../types";

const cfg = (over: Partial<RecordingConfig> = {}): RecordingConfig => ({
    directStreamUrl: "http://192.168.4.1:81/stream",
    proxyStreamUrl: "http://localhost:8082/stream",
    controlUrl: "http://localhost:8082",
    useProxy: true, ...over,
});

describe("cameraStreamUrl", () => {
    it("useProxy=true → プロキシ", () => { expect(cameraStreamUrl(cfg())).toBe("http://localhost:8082/stream"); });
    it("useProxy=false → 直URL", () => { expect(cameraStreamUrl(cfg({ useProxy: false }))).toBe("http://192.168.4.1:81/stream"); });
});
```
**② GREEN** `app/src/camera/stream-url.ts`
```ts
// stream-url.ts — ライブ表示の MJPEG URL を選ぶ(純)。録画時はプロキシ経由(=上流1本・CORS解決)。
import type { RecordingConfig } from "../types";

export function cameraStreamUrl(cfg: RecordingConfig): string {
    return cfg.useProxy ? cfg.proxyStreamUrl : cfg.directStreamUrl;
}
```

## 3. 増分3：`recControlUrl`（録画制御URLの組立）

**① テスト（RED）** `app/src/camera/control-url.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { recControlUrl } from "./control-url";

describe("recControlUrl", () => {
    it("start: session をクエリに付ける", () => {
        expect(recControlUrl("http://localhost:8082", "start", "2026-06-30T10-00-00-000Z"))
            .toBe("http://localhost:8082/rec/start?session=2026-06-30T10-00-00-000Z");
    });
    it("stop: /rec/stop", () => {
        expect(recControlUrl("http://localhost:8082", "stop", "x")).toBe("http://localhost:8082/rec/stop");
    });
    it("特殊文字はエンコード(防御的)", () => {
        expect(recControlUrl("http://x", "start", "a/b c")).toBe("http://x/rec/start?session=a%2Fb%20c");
    });
});
```
**② GREEN** `app/src/camera/control-url.ts`
```ts
// control-url.ts — 録画開始/停止の制御URLを組む(純)。sessionId を proxy へ渡し動画名を揃える。
export function recControlUrl(controlUrl: string, action: "start" | "stop", sessionId: string): string {
    return action === "start"
        ? `${controlUrl}/rec/start?session=${encodeURIComponent(sessionId)}`
        : `${controlUrl}/rec/stop`;
}
```
> vitest 実測：**stream-url 2＋control-url 3 = 5 tests pass**／`tsc --strict` 緑（確認済み）。

## 4. 増分4：`recorder-client`（fetch＝副作用は端へ）

```ts
// recorder-client.ts — 録画開始/停止を proxy へ通知する(副作用=fetch)。URL組立は control-url(純)に分離。
import { recControlUrl } from "./control-url";

export async function recStart(controlUrl: string, sessionId: string): Promise<void> {
    await fetch(recControlUrl(controlUrl, "start", sessionId), { method: "POST" });
}
export async function recStop(controlUrl: string): Promise<void> {
    await fetch(recControlUrl(controlUrl, "stop", ""), { method: "POST" });
}
```
> `fetch` は smoke。**判断（URL）は純関数に出してテスト済み**なので、ここは「投げるだけ」。

## 5. 増分5：`config.ts`（値の集約）

```ts
import type { RecordingConfig } from "./types";

export const recordingConfig: RecordingConfig = {
    directStreamUrl: CAM_URL,                        // 既存の直URL（http://192.168.4.1:81/stream）
    proxyStreamUrl: "http://localhost:8082/stream",
    controlUrl: "http://localhost:8082",
    useProxy: true,                                  // 録画運用は既定でプロキシ経由
};
```

---

## 6. 増分6：`main` 配線＝カメラを `recording` に相乗り（副作用＝smoke・**全文**）

> **前提（順序）**：[stage9](stage9-main-single-responsibility.md)（記録は `recording`＝`createRecordingSession` 所有・`render` は `recording.tick`）＋[stage11](stage11-sim-tactical-map.md)（`ui/draw`・`render` に `distanceCm`）適用済みの `main.ts` の上にカメラを相乗り（`runner`/`cleaning`/`protocol`/`recording-session` は無改造）。`config.ts` の `recordingConfig`・`camera/`（stream-url/control-url/recorder-client）・`types` の `RecordingConfig` は実装済み。

**統合は実質4点**（★）：①import に `recordingConfig`/`cameraStreamUrl`/`recStart`/`recStop`（`CAM_URL` 直 import は不要に）②`videoRecordable()` ゲート ③`#start` で `recordVideo`＋`recStart` ④`emergencyStop` で `recStop`、WiFi 接続成功時に `cam.src`。以下が **stage8c 後の `main.ts` 全文**（`tsc --strict` クリーン・camera テスト緑を実測確認済み）。

```ts
// main.ts — シムデモ＋実機自走の組み立て。部品を繋ぎ、ボタンに配線する。
import {
    defaultConfig,
    initialState,
    WS_URL,
    defaultMotionModel,
    telemetryConfig,
    recordingConfig,                                                          // ★stage8c: カメラ表示/録画の設定
} from "./config";
import { defaultSimConfig, readSensors } from "./sim/model";
import type { World } from "./sim/model";
import type { Transport } from "./io/transport";
import type { State, Sensors, Command, TrajectoryHeader } from "./types";
import { SimRobot } from "./sim/sim-robot";
import { createRunner } from "./runner";
import { draw } from "./ui/draw";
import { SerialTransport } from "./io/transport";
import { WebSocketTransport } from "./io/ws-transport";
import { RobotSession } from "./session";                                      // 接続の所有・差し替えを一手に持つ
import { createRecordingSession } from "./telemetry/recording-session";        // 記録(軌跡)の所有者
import { SimPoseSource, EstimatorPoseSource } from "./telemetry/pose-source";  // main は具象を選ぶだけ
import { downloadText } from "./telemetry/download";                           // 保存の副作用を注入
import { cameraStreamUrl } from "./camera/stream-url";                         // ★stage8c: 表示URL選択(proxy/direct)
import { recStart, recStop } from "./camera/recorder-client";                  // ★stage8c: 録画 start/stop を proxy へ

const canvas = document.querySelector<HTMLCanvasElement>("#sim")!;
const ctx = canvas.getContext("2d")!;

// 左寄り・右向きで開始(部屋の中で適当な初期姿勢)
const initialWorld: World = {
    pose: { x: 20, y: defaultSimConfig.roomH / 2, yawDeg: 0 },
    servoDeg: defaultConfig.scanCenterDeg,
};
const simRobot = new SimRobot(initialWorld, defaultSimConfig);

// 接続種別ラベル（接続成功時に usb/wifi へ）。
let connSource: TrajectoryHeader["source"] = "sim";

// ★カメラ録画できる条件: WiFi 接続時のみ(MJPEG は ESP32 AP 経由)＋プロキシ運用。
function videoRecordable(): boolean {
    return connSource === "wifi" && recordingConfig.useProxy;
}

// 副作用・時計・config を「ここ(合成点)」で1度だけ束ねて session に注入する。
const recording = createRecordingSession({
    now: Date.now,
    nowIso: () => new Date().toISOString(),
    precision: telemetryConfig.posePrecision,
    config: defaultConfig,
    download: downloadText,
});

// 記録中なら onTick を積み、軌跡トレイル付きで描く。未記録なら従来どおり描くだけ。
function render(state: State, sensors: Sensors, cmd: Command, truth?: World): void {
    const trail = recording.tick(state, sensors, cmd);
    if (trail) {
        const world = truth ?? { pose: trail[trail.length - 1], servoDeg: defaultConfig.scanCenterDeg };
        draw(ctx, world, defaultSimConfig, trail, sensors.distanceCm);
    } else if (truth) {
        draw(ctx, truth, defaultSimConfig, undefined, sensors.distanceCm);
    }
}

// 初期状態を1回描く（まだ sensors が無いので readSensors で距離を補う）。
const w0 = simRobot.getWorld();
draw(ctx, w0, defaultSimConfig, undefined, readSensors(w0, defaultSimConfig).distanceCm);

const simRunner = createRunner(simRobot, defaultConfig, initialState, (state, sensors, cmd) => {
    render(state, sensors, cmd, simRobot.getWorld());   // sim=真値 world ＋(記録中なら)トレイル
});

// --- 実機(自走)。接続できたらここに入る ---
const session = new RobotSession();

// 緊急停止: ループを止め、実機に stop を複数回送る＋(録画中なら)録画も止める。
async function emergencyStop(): Promise<void> {
    simRunner.stop();
    session.runner?.stop();
    for (let i = 0; i < 3; i++) {
        await session.robot?.send({ kind: "stop", speed: 0 }).catch(() => {});
    }
    if (videoRecordable()) void recStop(recordingConfig.controlUrl).catch(() => {});   // ★idle stop は安全
    console.log("■ 停止");
}

// 開始: 具象(sim/実機)を main が選び、記録を開始。WiFi なら録画も同じ sessionId で起動。
document.querySelector("#start")!.addEventListener("click", () => {
    const isReal = !!session.runner;
    const pose0 = simRobot.getWorld().pose;
    recording.start({
        poseSource: isReal ? new EstimatorPoseSource(pose0, defaultMotionModel) : new SimPoseSource(simRobot),
        estimated: isReal,
        source: isReal ? connSource : "sim",
        motionModel: defaultMotionModel,
        pose0,
        recordVideo: videoRecordable(),                  // ★WiFi時のみ header.videoFile=<sessionId>.mp4
    });
    if (videoRecordable()) void recStart(recordingConfig.controlUrl, recording.sessionId).catch(() => {});   // ★軌跡と同じ id
    (session.runner ?? simRunner).start();               // 実機接続済みなら実機、未接続なら Sim
});

// 停止: 緊急停止(stopを複数回送る)。ボタンもキー(Esc/Space)と同じ確実な停止にする。
document.querySelector("#stop")!.addEventListener("click", () => { void emergencyStop(); });

// キーボードでも緊急停止(Esc / Space)。暴走時の保険。
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === " ") { e.preventDefault(); void emergencyStop(); }
});

// 保存: 直近の記録を NDJSON / CSV で書き出す(停止後にDL)。factory なので裸渡しOK。
document.querySelector("#save-ndjson")!.addEventListener("click", recording.saveNDJSON);
document.querySelector("#save-csv")!.addEventListener("click", recording.saveCSV);

const connectBtn = document.querySelector<HTMLButtonElement>("#connect")!;
const wifiBtn = document.querySelector<HTMLButtonElement>("#connect-wifi")!;

// USB/WiFi 共通の接続処理。Transport の開け方だけ差し替え、あとは session に委ねる。
async function connect(openTransport: () => Promise<Transport>, okMsg: string, source: TrajectoryHeader["source"]): Promise<boolean> {
    connectBtn.disabled = wifiBtn.disabled = true;
    try {
        await session.connect(openTransport, (robot) => createRunner(
            robot, defaultConfig, initialState, (state, sensors, cmd) => {
                console.log(`[tick] dist=${sensors.distanceCm}cm phase=${state.phase} left=${state.turnTicksLeft} cmd=${cmd.kind}`);
                render(state, sensors, cmd);            // 記録＋推定トレイル描画(実機は truth 無し)
            }
        ));
        await session.robot?.send({ kind: "stop", speed: 0, aimDeg: defaultConfig.scanCenterDeg });
        connSource = source;                            // ヘッダ source 用に接続種別を保持
        console.log(okMsg);
        return true;
    } catch (e) {
        console.warn("接続失敗:", (e as Error).message);
        return false;
    } finally {
        connectBtn.disabled = wifiBtn.disabled = false;
    }
}

// USB接続: ユーザー操作内で requestPort が要るので click ハンドラ直下で開く。
connectBtn.addEventListener("click", () => {
    void connect(() => SerialTransport.open(), "実機接続OK。『開始』で自走、『停止』/Esc/Spaceで停止。", "usb");
});

// WiFi接続: WS中継経由でつなぐ。成功時だけカメラ表示(プロキシ経由＝CORS解決/上流1本)。
wifiBtn.addEventListener("click", async () => {
    const ok = await connect(() => WebSocketTransport.open(WS_URL), "WiFi接続OK。『開始』で自走、『停止』/Esc/Spaceで停止。", "wifi");
    if (ok) {
        const cam = document.querySelector<HTMLImageElement>("#cam");
        if (cam) cam.src = cameraStreamUrl(recordingConfig);   // ★proxy 経由。録画も同じ上流から
    }
});
```
> **stage7/9 との同期**：`videoFile`（軌跡ヘッダ）と録画ファイルが**共通 `sessionId`** で一致。軌跡 `trajectory-<sessionId>.ndjson` の `videoFile`＝`<sessionId>.mp4` を指し、時刻軸（`t0`／ffmpeg の wallclock）で「動画のこの瞬間＝地図のここ」を突き合わせられる。`sessionId`/`t0` の発行元は `recording`（stage9）。録画は **run の開始/停止に同期**（`#start`→`recStart`／停止→`recStop`）するので、動画と軌跡が同区間になる。`#rec-stop` 専用ボタンは作らない（停止導線に相乗り）。

---

## 7. システムフロー（録画セッション一気通貫）

```
[WiFi接続成功] (ws-bridge:8081 制御 / cam-proxy:8082 カメラ。両Nodeを起動)
   └ cam.src = cameraStreamUrl(recordingConfig)  // プロキシ経由のライブ表示(WiFi時のみ)   (8c: connect 内)

[開始 #start]→ recording.start({... recordVideo: videoRecordable() })
        // id/t0/header を recording が発行・videoFile=<id>.mp4                  (stage9)
   └ if videoRecordable(): recStart(controlUrl, recording.sessionId)  // proxy が ffmpeg 起動(同じ id) (8c→8b)
   └ (session.runner ?? simRunner).start()
   tick: read→step→send→onTick → recorder.onTick(...)  // 軌跡を蓄積(stage7)
         ＝同時に cam-proxy が recordings/<sessionId>.mp4 へ録画(8b)
         （カメラは独立チャネル＝Serial/WS とは別系統。runner/cleaning 無改造）

[停止 #stop/Esc/Space]→ emergencyStop() → if videoRecordable(): recStop(controlUrl)  // mp4 確定 (8c→8b)
[保存 #save-ndjson]→ recording.saveNDJSON()  // trajectory-<sessionId>.ndjson をDL          (stage7)
   ⇒ <sessionId>.mp4(proxy がサーバ側保存) と trajectory-<sessionId>.ndjson(ブラウザDL) が同じ sessionId/時刻軸で残る
```
> 録画は WiFi 限定（sim/USB はカメラ無し＝`videoRecordable()` が false）。`recordVideo:false` のとき軌跡ヘッダ `videoFile` は `null`。

---

## 8. stage6 / stage7 の影響（考慮点）

| 由来 | 影響 | 対応 |
|---|---|---|
| **stage7/9** | `sessionId`/`t0`/`videoFile` を共有して動画⇔軌跡を対にする | 本書 §6 で `recording.start({recordVideo})`＝header.videoFile を紐付け、`recording.sessionId` で録画起動。`recorder`/`runner` は無改造 |
| **stage6** | 挙動変化（毎tick サーボ＋駆動、scan で停止、reverse）。**カメラの型/コードには影響なし** | 型変更なし。録画は scan 中の停止で**ブレが減る**側 |
| **stage6（負荷）** | 制御トラフィック増（サーボ＋駆動の2書込/tick）＋カメラ配信＋録画で **ESP32/WiFi 負荷が増す** | §9 リスク。プロキシで上流1本に絞るのが効く。実機 smoke で fps 低下を確認 |
| **カメラ位置** | 本体固定（超音波サーボの首振りとは別）。scan してもカメラ視点は動かない | 視点は安定＝録画は素直 |

---

## 9. リスク・未確認（実機で潰す）
- **ESP32 同時 stream 数**（[8b §0](stage8b-recording-pipeline.md) で実測）。1ならプロキシ必須。
- **stage6 と同時運用時の帯域**：scan の制御往復＋カメラ＋録画で fps 低下/切断が出ないか（満充電・短時間から）。
- **CORS 汚染**：プロキシ（localhost＋`Access-Control-Allow-Origin:*`）で解ける前提。直URLのままだと canvas 録画(R1)は不可。
- **混在コンテンツ**：アプリは `http://localhost`、プロキシも http なので可（https 配信は映像ブロック＝[stage5 §7](stage5-wireless-camera.md)）。
- **録画と軌跡の時刻ズレ**：ffmpeg は wallclock、軌跡は `t0` 相対。サイドカー `startedAtIso` で突き合わせ。秒未満のズレは許容。

---

## 10. Definition of Done（stage8 全体のゲート）
- [ ] `cd tools && npm test` 緑（demux/ffmpeg-args/multipart/recording-paths＝node:test）／**`npm run typecheck` 緑（JSDoc＋checkJs --strict）**。
- [ ] `cd app && npm run test:run` 緑（camera の stream-url/control-url）／`npm run typecheck` 緑。
- [ ] **実機 smoke（[8b §0](stage8b-recording-pipeline.md)）**：ffmpeg 直録りで再生可・同時stream数を実測。
- [ ] **プロキシ smoke**：`http://localhost:8082/stream` が映る／`rec/start`→`rec/stop` で `recordings/<sessionId>.mp4` が**再生でき実時間長**。
- [ ] **同期確認**：同一 `sessionId` で `<id>.mp4` と `trajectory-<id>.ndjson`（`videoFile` 一致）が残る。
- [ ] [current-build-spec.md](../reference/current-build-spec.md) §5 を「カメラ＝録画可（プロキシ＋ffmpeg）」へ更新。

---
関連：[stage8a](stage8a-mjpeg-demux.md)／[stage8b](stage8b-recording-pipeline.md)／ [stage7d](stage7d-recorder-and-ui.md)（sessionId/videoFile の発行元）／ [design-trajectory-recording-architecture.md](../reference/design-trajectory-recording-architecture.md) §7／ [code-design.md](code-design.md) §6.1（カメラは独立チャネル）／ [stage5-wireless-camera.md](stage5-wireless-camera.md)
</content>
