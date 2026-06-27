// config.ts — 調整値の唯一の置き場（ハードコーディングの集約先）

// 値の根拠は cleaning-logic-spec.md。実機チューニングはここだけ書き換える。
import type { Config, State } from "./types";

/** 掃除ロジックの既定パラメータ。 */
export const defaultConfig: Config = {
    wallCm: 20,             // 20cm より近づいたら旋回（spec の既定）
    turnTicks: 4,           // ★タイマ旋回: 4tick 回る(tickMs=120 → 約480ms)。実機で90度になるよう調整
    turnDir: "left",        // 既定は左回り。"right" にすれば右回り
    driveSpeed: 120,        // 直進速度（控えめ＝壁検知の余裕を確保）
    turnSpeed: 150,         // 旋回速度（その場旋回は少し強めに）

    // 制御周期（tickMs）＝「センサを読む→次の動きを決める→指令を送る」を1回まわす間隔
    tickMs: 120,            // 制御周期（spec の目安 ~120ms）

    liftStop: false,        // ★実機の離地センサが不安定なので既定OFF(firmware も N=3 は離地で止めない)
}

/** 状態機械の初期状態：まず直進から始める。 */
export const initialState: State = {
    phase: "drive",
    turnTicksLeft: 0,       // ★最初は旋回していない
}

// WiFi接続先(WS中継 / カメラMJPEG)。USB は requestPort なのでURL不要。
export const WS_URL = "ws://localhost:8081";
export const CAM_URL = "http://192.168.4.1:81/stream";
