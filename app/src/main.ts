// main.ts — シムデモ＋実機自走の組み立て。部品を繋ぎ、ボタンに配線する。
import { defaultConfig, initialState } from "./config";
import { defaultSimConfig } from "./sim/model";
import type { World } from "./sim/model";
import { SimRobot } from "./sim/sim-robot";
import { createRunner } from "./runner";
import type { Runner } from "./runner";
import { draw } from "./ui";
import { SerialTransport } from "./io/transport";
import { SerialRobot } from "./io/serial-robot";
import { WebSocketTransport } from "./io/ws-transport";

// 定数(ファイル上部のどこか)
const WS_URL = "ws://localhost:8081";
const CAM_URL = "http://192.168.4.1:81/stream";

const canvas = document.querySelector<HTMLCanvasElement>("#sim")!;
const ctx = canvas.getContext("2d")!;

// 左寄り・右向きで開始(部屋の中で適当な初期姿勢)
const initialWorld: World = {
    pose: { x: 20, y: defaultSimConfig.roomH / 2, yawDeg: 0},
};
const simRobot = new SimRobot(initialWorld, defaultSimConfig);
const simRunner = createRunner(simRobot, defaultConfig, initialState, () => {
    draw(ctx, simRobot.getWorld(), defaultSimConfig);
});
draw(ctx, simRobot.getWorld(), defaultSimConfig); // 初期状態を1回描く

// --- 実機(自走)。接続できたらここに入る ---
let realRunner: Runner | null = null;
let realRobot: SerialRobot | null = null;   // 緊急停止で直接 stop を送るため保持

// 緊急停止: ループを止め、実機に stop を複数回送る(25m USB で1フレーム落ちても止まるように)
async function emergencyStop(): Promise<void> {
    simRunner.stop();
    realRunner?.stop();
    for (let i = 0; i < 3; i++) {
        await realRobot?.send({ kind: "stop", speed: 0 }).catch(() => {});
    }
    console.log("■ 停止");
}

// 開始: 実機接続済みなら実機を、未接続ならシムを走らせる
document.querySelector("#start")!.addEventListener("click", () => {
    (realRunner ?? simRunner).start();      // 実機接続済みなら実機、未接続ならシム
});

// 停止: 緊急停止(stopを複数回送る)。ボタンもキー(Esc/Space)と同じ確実な停止にする。
document.querySelector("#stop")!.addEventListener("click", () => { void emergencyStop(); });

// キーボードでも緊急停止(Esc / Space)。暴走時の保険。
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === " ") { e.preventDefault(); void emergencyStop(); }
})


// 実機接続: ポートを開き、SerialRobot で runner を組む(まだ走らせない=安全)
document.querySelector("#connect")!.addEventListener("click", async () => {
    const tx = await SerialTransport.open();          // ★ユーザー操作内で requestPort
    realRobot = new SerialRobot(tx);
    realRunner = createRunner(realRobot, defaultConfig, initialState, (state, sensors, cmd) => {
        // 壁検知が効いているか見えるよう、距離・相・指令をログ
        console.log(`[tick] dist=${sensors.distanceCm}cm phase=${state.phase} left=${state.turnTicksLeft} cmd=${cmd.kind}`);
    });
    console.log("実機接続OK。『開始』で自走、『停止』またはEsc/Spaceで停止。");
});

// WiFi接続: WebSocketTransport に差し替えるだけ(同じ SerialRobot/runner)。カメラも表示。
document.querySelector("#connect-wifi")!.addEventListener("click", async () => {
    const tx = await WebSocketTransport.open(WS_URL);
    realRobot = new SerialRobot(tx);                  // ★同じ SerialRobot(Transport 依存)
    realRunner = createRunner(realRobot, defaultConfig, initialState, (state, sensors, cmd) => {
        console.log(`[tick] dist=${sensors.distanceCm}cm phase=${state.phase} left=${state.turnTicksLeft} cmd=${cmd.kind}`);
    });
    const cam = document.querySelector<HTMLImageElement>("#cam");
    if (cam) cam.src = CAM_URL;                       // カメラ映像を表示
    console.log("WiFi接続OK。『開始』で自走、『停止』/Esc/Spaceで停止。");
});
