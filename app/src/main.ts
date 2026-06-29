// main.ts — シムデモ＋実機自走の組み立て。部品を繋ぎ、ボタンに配線する。
import { defaultConfig, initialState, WS_URL, CAM_URL } from "./config";
import { defaultSimConfig } from "./sim/model";
import type { World } from "./sim/model";
import type { Transport } from "./io/transport";
import { SimRobot } from "./sim/sim-robot";
import { createRunner } from "./runner";
import { draw } from "./ui";
import { SerialTransport } from "./io/transport";
import { WebSocketTransport } from "./io/ws-transport";
import { RobotSession } from "./session";       // 接続の所有・差し替え(旧を畳んでから新)を一手に持つ

const canvas = document.querySelector<HTMLCanvasElement>("#sim")!;
const ctx = canvas.getContext("2d")!;

// 左寄り・右向きで開始(部屋の中で適当な初期姿勢)
const initialWorld: World = {
    pose: { x: 20, y: defaultSimConfig.roomH / 2, yawDeg: 0},
    servoDeg: defaultConfig.scanCenterDeg,
};
const simRobot = new SimRobot(initialWorld, defaultSimConfig);
const simRunner = createRunner(simRobot, defaultConfig, initialState, () => {
    draw(ctx, simRobot.getWorld(), defaultSimConfig);
});
draw(ctx, simRobot.getWorld(), defaultSimConfig); // 初期状態を1回描く

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

// 開始: 実機接続済みなら実機を、未接続ならシムを走らせる
document.querySelector("#start")!.addEventListener("click", () => {
    (session.runner ?? simRunner).start();      // 実機接続済みなら実機、未接続ならシム
});

// 停止: 緊急停止(stopを複数回送る)。ボタンもキー(Esc/Space)と同じ確実な停止にする。
document.querySelector("#stop")!.addEventListener("click", () => { void emergencyStop(); });

// キーボードでも緊急停止(Esc / Space)。暴走時の保険。
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === " ") { e.preventDefault(); void emergencyStop(); }
})

const connectBtn = document.querySelector<HTMLButtonElement>("#connect")!;
const wifiBtn = document.querySelector<HTMLButtonElement>("#connect-wifi")!;

// USB/WiFi 共通の接続処理。Transport の開け方だけ差し替え、あとは session に委ねる。
// session.connect が「旧を stop→close してから新を張る」ので、二重接続=ゾンビ runner が生まれない。
// まだ走らせない(start しない)=安全。返り値は成功可否(カメラ表示の判断に使う)。
async function connect(openTransport: () => Promise<Transport>, okMsg: string): Promise<boolean> {
    connectBtn.disabled = wifiBtn.disabled = true;      // open 中は多重クリック不可
    try {
        await session.connect(openTransport, (robot) => createRunner(
            robot, defaultConfig, initialState, (state, sensors, cmd) => {
                // 壁検知が効いているか見えるよう、距離・相・指令をログ
                console.log(`[tick] dist=${sensors.distanceCm}cm phase=${state.phase} left=${state.turnTicksLeft} cmd=${cmd.kind}`);
            }
        ));
        await session.robot?.send({ kind: "stop", speed: 0, aimDeg: defaultConfig.scanCenterDeg });
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
    void connect(() => SerialTransport.open(), "実機接続OK。『開始』で自走、『停止』/Esc/Spaceで停止。");
});

// WiFi接続: WS中継経由でつなぐ。USB と違うのは Transport の開け方とカメラ表示だけ。
wifiBtn.addEventListener("click", async () => {
    const ok = await connect(() => WebSocketTransport.open(WS_URL), "WiFi接続OK。『開始』で自走、『停止』/Esc/Spaceで停止。");
    if (ok) {
        const cam = document.querySelector<HTMLImageElement>("#cam");
        if (cam) cam.src = CAM_URL;     // カメラはWiFi接続成功時だけ表示
    }
});
