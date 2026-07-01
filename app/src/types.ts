import type { Estimated } from "./domain/estimated";
// types.ts — 掃除ロジックの契約（型のみ。値・ロジックは持たない）
//
// この4つはロジックの「入口・出口・記憶・調整つまみ」に対応する:
//   Sensors  … 入力（実機 or シムから来るセンサ値）
//   Command  … 出力（実機 or シムへ渡す“素の”指令）
//   State    … 内部状態（DRIVE/TURN の状態機械の記憶）
//   Config   … 調整つまみ（しきい値・速度。実体は config.ts）

/** ロボットから読む1ティック分のセンサ値。 */
export type Sensors = {
    /** 前方距離 [cm]。実機は N=21、シムはレイキャストで供給。 */
    distanceCm: number;
  
    /** 機体の向き（ヨー角）[度]。旋回量の判定に使う。 */
    yawDeg: number;
    
    /** 持ち上げ検知。true=床から離れている → 安全停止。実機は N=23。 */
    lifted: boolean;
}

/** ロボットの姿勢。x,y は cm, yawDeg は度(0は+x方向, 反時計回りが +)。 
   yawDeg は度（＝向き）。:

  (a) 0° は +x方向（右）を向いている
     +y(奥)
      ↑
   ───┼───→ +x   ← yaw=0° はこの向き(右)
      │(0,0)
      
  (b) 反時計回り（左）が ＋ に増える
         yaw=90°(上)
            ↑
   yaw=180°←●→ yaw=0°(右)
            ↓
         yaw=-90°(下)
  左に首を振ると角度が増え、右に振ると減る。
*/
export type Pose = { x: number; y: number; yawDeg: number };

/** 旋回の向き。 */
export type TurnDir = "left" | "right";

/** 制御の相。drive=直進 / scanLeft|scanRight=首振り測定 / turn=旋回 / reverse=後退。 */
export type Phase = "drive" | "scanLeft" | "scanRight" | "turn" | "reverse";

/**
 * ロボットへ渡す“素の”駆動指令。判断結果をここに表すだけで、
 * JSON への変換は protocol 層（段階3）の責務。
 *   forward     … 直進（ジャイロ直進は UNO 側が担当）
 *   reverse     … 後退 
 *   rotateLeft  … その場・左旋回
 *   rotateRight … その場・右旋回
 *   stop        … 停止（持ち上げ時など）
 */
export type Command = {
    kind: "forward" | "reverse" | "rotateLeft" | "rotateRight" | "stop";

    /** モータPWMデューティ(0–255, 8bit)。物理速度ではない。stop は 0。
    *  ※自走系モードでは実機側が 180 で上限クランプ(firmware 既定)。 */
    speed: number;

    /** 指定時、超音波の首(サーボZ)をこの角度[10..170, 10刻み]へ。省略時は動かさない。 */
    aimDeg?: number;
};

/**
 * 掃除ロジックの内部状態（DRIVE/TURN の2相）。
 *   phase="drive" … 壁まで直進中
 *   phase="turn"  … 旋回中。startYaw からの差が targetDeg に達したら drive へ戻る
 */
export type State = {
    phase: Phase;

    /** turn 中の残り tick 数。drive では 0。1 以下になった tick で直進へ戻る(タイマ旋回)。 */
    turnTicksLeft: number;

    /** scanLeft で測った左距離[cm]。未測定 -1。 */
    leftCm: number;

    /** scan で決めた今回の旋回向き。 */
    turnDir: TurnDir;

    /** reverse 中の残り tick。 */
    reverseTicksLeft: number;
};

/**
 * 調整つまみ（しきい値・速度・周期）。実体の値は config.ts に1か所だけ置く。
 * ロジック（cleaning.ts）は数値を直書きせず、必ずこの cfg を引数で受ける
 * ＝ ハードコーディング排除。
 */
export type Config = {
    /** これより近い前方距離で旋回に切り替える壁しきい値 [cm]。 */
    wallCm: number;

    /** 1回の旋回に費やす tick 数(タイマ旋回)。旋回時間 = tickMs × turnTicks。実機で約90度になるよう調整。 */
    turnTicks: number;

    /** 壁に当たったとき回る向き。"left"=左回り / "right"=右回り。 */
    turnDir: "left" | "right";

    /** 直進時のモータ速度。 */
    driveSpeed: number;

    /** 旋回時のモータ速度。 */
    turnSpeed: number;

    /** 制御ループの周期 [ms]（read→step→send の間隔）。 */
    tickMs: number;

    /** 離地(持ち上げ)で安全停止するか。実機の離地センサが床を誤検知する場合は false に。 */
    liftStop: boolean;

    /** 首を左に向ける角度[度]。10の倍数。体の左右と一致させる(N3)。 */
    scanLeftDeg: number;

    /** 首を右に向ける角度[度]。10の倍数。体の左右と一致させる(N3)。 */
    scanRightDeg: number;

    /** スキャン時の首の正面角[度]。10の倍数。 */
    scanCenterDeg: number;

    /** これ以上(or 0=エコー無し)で「空き」と見なす距離[cm]。wallCm より大きく。 */
    openCm: number;

    /** 後退の速度。 */
    reverseSpeed: number;

    /** 両側塞がり時に後退する tick 数。 */
    reverseTicks: number;

    /** 180度旋回の tick 数(≒turnTicks×2)。 */
    turnTicks180: number;
};

export type StepResult = {
    cmd: Command;
    next: State;
};

/** PWM→物理量の校正（推定の根拠）。 */
export type MotionModel = {
    forwardCmPerSec: number;    // forward(driveSpeed) の実速度[cm/s]。
    reverseCmPerSec: number;    // reverse(reverseSpeed) の実速度[cm/s]。
    turnDegPerSec: number;      // rotate(turnSpeed) の実角速度[deg/s]。
    refDriveSpeed: number;      // 上記 cm/s を測った前進/後退PWM(速度スケール基準)
    refTurnSpeed: number;       // 上記 deg/s を測った旋回PWM
};

/** makeSample の入力：1tick分の生の観測（recorder が毎tick組み立てて渡す）。precision は別引数(config由来)。 */
export type TickObservation = {
    t: number;                  // セッション基準 t0 からの相対[ms]（動画と同じ時間軸）
    dt: number;                 // 直前tickからの実経過[ms]（推定に使った値）
    cmd: Command;
    sensors: Sensors;
    phase: State["phase"];
    pose: Estimated<Pose>;   // sim=真値/実機=推定(どちらもセンサー実測でない)
    estimated: boolean;         // true=推定(実機) / false=真値(sim)
};

/** 1tick分の記録（軌跡ログの最小単位）。 */
export type TickSample = {
    t: number;                  // セッション基準 t0 からの相対[ms]（動画と同じ時間軸）
    dt: number;                 // 直前tickからの実経過[ms]（推定に使った値）
    cmdKind: Command["kind"];
    speed: number;
    distanceCm: number;
    lifted: boolean;
    phase: State["phase"];
    pose: Estimated<Pose>;   // sim=真値/実機=推定(どちらもセンサー実測でない)
    estimated: boolean;         // true=推定(実機) / false=真値(sim)
};

/** 軌跡ログのヘッダ（自己記述的：再現に要る文脈を入れる）。 */
export type TrajectoryHeader = {
    v: number;
    sessionId: string;
    startedAtIso: string;
    source: "sim" | "usb" | "wifi";
    config: Config;
    motionModel: MotionModel;
    pose0: Pose;
    videoFile: string | null;   // カメラ録画(stage8)と紐付け。無ければ null
};

/** カメラ録画/ライブ表示の設定（値は config.ts に集約）。 */
export type RecordingConfig = {
    directStreamUrl: string;    // ESP32 直 MJPEG（ex: http://192.168.4.1:81/stream）
    proxyStreamUrl: string;     // プロキシ経由（ex: http://localhost:8082/stream）
    controlUrl: string;         // 録画制御（ex: http://localhost:8082）
    useProxy: boolean;          // true=プロキシ経由（録画・CORS解決） / false=直URL
};

/** 実測の距離サンプル(robot 相対)。位置に積分しない=ドリフトしない。 */
export type SonarSample = {
    relDeg: number;             // ロボット正面からの相対方向[度](0=正面・反時計回りが+)。首の「指令」方向
    distanceCm: number;         // 超音波の「実測」距離[cm](>0)
    t: number;                  // 実測時刻[ms]
};
