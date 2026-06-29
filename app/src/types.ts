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
}

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
}

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
}

export type StepResult = {
    cmd: Command;
    next: State;
}
