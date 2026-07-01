// main.ts — シムデモ＋実機自走の組み立て。部品を繋ぎ、ボタンに配線する。
import {
    defaultConfig,
    initialState,
    WS_URL,
    defaultMotionModel,
    telemetryConfig,
    recordingConfig,
    sonarConfig
} from "./config";
import { defaultSimConfig } from "./sim/model";
import type { World } from "./sim/model";
import type { Transport } from "./io/transport";
import type { State, Sensors, Command, TrajectoryHeader, SonarSample } from "./types";
import { SimRobot } from "./sim/sim-robot";
import { createRunner } from "./runner";
import { nextServoDeg } from "./ui/geometry";
import { drawSonar } from "./ui/sonar-view";
import { linkStatusView } from "./ui/status";                                  // 接続状態→ヘッダ表示(純)
import { SerialTransport } from "./io/transport";
import { WebSocketTransport } from "./io/ws-transport";
import { RobotSession } from "./session";                                      // 接続の所有・差し替え(旧を畳んでから新)を一手に持つ
import { createRecordingSession } from "./telemetry/recording-session";        // 記録の所有者
import { SimPoseSource, EstimatorPoseSource } from "./telemetry/pose-source";  // main は具象を選ぶだけ
import { downloadText } from "./telemetry/download";                           // 保存の副作用を注入
import { cameraStreamUrl } from "./camera/stream-url";                         // 表示URL選択(proxy/direct)
import { recStart, recStop } from "./camera/recorder-client";                  // 録画 start/stop を proxy へ
import { toSonarSample, pruneSonar } from "./sensing/sonar";

const canvas = document.querySelector<HTMLCanvasElement>("#sim")!;
const ctx = canvas.getContext("2d")!;

// 左寄り・右向きで開始(部屋の中で適当な初期姿勢)
const initialWorld: World = {
    pose: { x: 20, y: defaultSimConfig.roomH / 2, yawDeg: 0},
    servoDeg: defaultConfig.scanCenterDeg,
};
const simRobot = new SimRobot(initialWorld, defaultSimConfig);

// 接続種別ラベル（接続成功時に usb/wifi へ。）
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

const forward = defaultSimConfig.servoForwardDeg;   // 正面角

// 実機の首(指令)方向を持ち回す
let realServoDeg = forward;
let sonar: SonarSample[] = [];


// 記録中なら onTick を積み、軌跡トレイル付きで描く。未記録なら従来どおり描くだけ。
// truth: シムは真値 world を渡す／実機は無いので、記録した推定 pose から world を組んで描く。
function render(state: State, sensors: Sensors, cmd: Command): void {
    recording.tick(state, sensors, cmd);
    realServoDeg = nextServoDeg(realServoDeg, cmd.aimDeg);
    const now = Date.now();
    const s = toSonarSample(
        realServoDeg, 
        forward, 
        sensors.distanceCm, 
        now, 
        sonarConfig.maxCm
    );
    if (s) sonar.push(s);
    sonar = pruneSonar(sonar, now, sonarConfig.windowMs);
    drawSonar(ctx, sonar, sensors, cmd, realServoDeg, forward, sonarConfig);
}

const simRunner = createRunner(simRobot, defaultConfig, initialState, (state, sensors, cmd) => {
    render(state, sensors, cmd);   // sim=真値 world ＋(記録中なら)トレイル
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
    
    if (videoRecordable()) recStop(recordingConfig.controlUrl).catch(() => {});

    console.log("■ 停止");
}

// 接続状態バッジ(ヘッダ)と架空(SIM)バッジ。状態を偽らない(stage13f)。
const linkEl = document.querySelector<HTMLElement>("#link")!;
const linkText = document.querySelector<HTMLElement>("#link-text")!;
const simBadge = document.querySelector<HTMLElement>("#sim-badge")!;
function setLink(source: TrajectoryHeader["source"]): void {
    const v = linkStatusView(source);           // 純関数(テスト済)
    linkText.textContent = v.label;
    linkEl.dataset.tone = v.tone;               // CSS が data-tone で色分け(sim=琥珀/live=緑)
}
setLink("sim");                                 // 初期＝未接続(架空)

// 開始: 実機接続済みなら実機を、未接続ならシムを走らせる
document.querySelector("#start")!.addEventListener("click", () => {
    const isReal = !!session.runner;
    simBadge.hidden = isReal;                   // 未接続(sim)で開始→「架空環境」バッジを出す
    const pose0 = simRobot.getWorld().pose;
    recording.start({
        poseSource: isReal 
        ? new EstimatorPoseSource(pose0, defaultMotionModel) 
        : new SimPoseSource(simRobot),
        estimated: isReal,
        source: isReal ? connSource : "sim",
        motionModel: defaultMotionModel,
        pose0,
        recordVideo: videoRecordable(),         // WiFi時のみ header.videoFile=<sessionId>.mp4
    });

    if (videoRecordable()) {
        void recStart(recordingConfig.controlUrl, recording.sessionId).catch(() => {});
    }

    (session.runner ?? simRunner).start();      // 実機接続済みなら実機、未接続ならSim
});

// 停止: 緊急停止(stopを複数回送る)。ボタンもキー(Esc/Space)と同じ確実な停止にする。
document.querySelector("#stop")!.addEventListener("click", () => { void emergencyStop(); });

// キーボードでも緊急停止(Esc / Space)。暴走時の保険。
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === " ") { e.preventDefault(); void emergencyStop(); }
});

// 保存: 直近の記録を NDJSON で書き出す(停止後にDL)。
document.querySelector("#save-ndjson")!.addEventListener("click", recording.saveNDJSON);

// 保存: 直近の記録を CSV で書き出す(停止後にDL)。
document.querySelector("#save-csv")!.addEventListener("click", recording.saveCSV);

const connectBtn = document.querySelector<HTMLButtonElement>("#connect")!;
const wifiBtn = document.querySelector<HTMLButtonElement>("#connect-wifi")!;

// USB/WiFi 共通の接続処理。Transport の開け方だけ差し替え、あとは session に委ねる。
// session.connect が「旧を stop→close してから新を張る」ので、二重接続=ゾンビ runner が生まれない。
// まだ走らせない(start しない)=安全。返り値は成功可否(カメラ表示の判断に使う)。
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
        setLink(source);                                // ★ヘッダを live 表示(USB/WiFi)に
        console.log(okMsg);
        return true;
    } catch (e) {
        console.warn("接続失敗:", (e as Error).message);   // 失敗=未接続(安全側)。シムは使える
        setLink("sim");                                 // ★失敗＝未接続(架空)のまま
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
        if (cam) cam.src = cameraStreamUrl(recordingConfig);   // カメラ・録画はWiFi接続成功時だけ表示
    }
});
