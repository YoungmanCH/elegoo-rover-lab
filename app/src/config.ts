// config.ts — 調整値の唯一の置き場（ハードコーディングの集約先）

// 値の根拠は cleaning-logic-spec.md。実機チューニングはここだけ書き換える。
import type { Config, State, MotionModel, RecordingConfig } from "./types";

/** 掃除ロジックの既定パラメータ。 */
export const defaultConfig: Config = {
    wallCm: 20,             // 20cm より近づいたら旋回（spec の既定）
    turnTicks: 6,           // ★タイマ旋回: 4tick 回る(tickMs=120 → 約480ms)。実機で90度になるよう調整
    turnDir: "left",        // 既定は左回り。"right" にすれば右回り
    driveSpeed: 80,        // 直進速度（控えめ＝壁検知の余裕を確保）
    turnSpeed: 100,         // 旋回速度（その場旋回は少し強めに）

    // 制御周期（tickMs）＝「センサを読む→次の動きを決める→指令を送る」を1回まわす間隔
    tickMs: 120,            // 制御周期（spec の目安 ~120ms）

    liftStop: false,        // ★実機の離地センサが不安定なので既定OFF(firmware も N=3 は離地で止めない)

    // 左を見る(体の左。実機で逆なら 30 と入替=N3)
    scanLeftDeg: 150,

    // 右を見る
    scanRightDeg: 30,

    // （正面角。10の倍数）
    scanCenterDeg: 90,

    // wallCm(20) より大きく
    openCm: 30,

    /** 後退の速度。 */
    reverseSpeed: 80,

    // ≒360ms 後退
    reverseTicks: 3,

    // ≒turnTicks×2。実機で約180度になるよう校正
    turnTicks180: 12,
}

/** 推定の校正値。実測して埋める。 */
export const defaultMotionModel: MotionModel = {
    forwardCmPerSec: 22,                    // driveSpeed の実速度。要実測。目標20〜30cm/s
    reverseCmPerSec: 22,                    // reverseSpeed の実速度。要実測(前進と同程度を仮置き)
    turnDegPerSec: 90,                      // turnSpeed の実角速度。要実測。目標60〜120°/s
    refDriveSpeed: defaultConfig.driveSpeed,
    refTurnSpeed: defaultConfig.turnSpeed,
}

/** 軌跡ログの調整。 */
export const telemetryConfig = {
    posePrecision: 1,                       // pose の小数桁
}

/** 状態機械の初期状態：まず直進から始める。 */
export const initialState: State = {
    phase: "drive",
    turnTicksLeft: 0,       // ★最初は旋回していない
    leftCm: -1,
    turnDir: "left",
    reverseTicksLeft: 0,
}

// WiFi接続先(WS中継 / カメラMJPEG)。USB は requestPort なのでURL不要。
export const WS_URL = "ws://localhost:8081";
export const CAM_URL = "http://192.168.4.1:81/stream";

export const recordingConfig: RecordingConfig = {
    directStreamUrl: CAM_URL,                        // 既存の直URL（http://192.168.4.1:81/stream）
    proxyStreamUrl: "http://localhost:8082/stream",
    controlUrl: "http://localhost:8082",
    useProxy: true,                                  // 録画運用は既定でプロキシ経由
}
