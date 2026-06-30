// pose-source.ts — 「次の Pose をくれ」の抽象。真値(Sim)/推定(Estimator)を差し替える。
import type { Pose, Command, MotionModel } from "../types";
import { estimateStep } from "../localization/pose-estimator";

/**
 * 次tickの Pose を返す抽象。実装は真値(Sim)か推定(Estimator)。
 * @param cmd   この tick に出した指令。
 * @param dtMs  直前tickからの実経過[ms]（名目tickではなく実測。推定の積分に使う）。
 * @returns     本体姿勢 Pose（x,y は[cm]／yawDeg は[度], 0=+x方向・反時計回りが+）。
 */
export interface PoseSource { next(cmd: Command, dtMs: number): Pose; }

/** sim 用：シムが既に知っている真値 pose を覗くだけ（推定しない＝誤差ゼロ）。 */
export class SimPoseSource implements PoseSource {
    constructor(private sim: { getWorld(): { pose: Pose }}) {}

    // 真値。cmd/dt は使わないが、PoseSource と同じ引数で宣言する(具象型経由で next(cmd,dt) と呼ぶため)。
    next(_cmd: Command, _dtMs: number): Pose { return this.sim.getWorld().pose; }
}

/**
 * 実機用：エンコーダが無いので推測航法(dead-reckoning)で pose を推定する。
 * pose を内部状態として持ち、next() のたびに estimateStep で1tick進める。
 */
export class EstimatorPoseSource implements PoseSource {
    // pose=初期姿勢 / m=校正(PWM→物理量)
    constructor(private pose: Pose, private m: MotionModel) {}
    
    // cmd と実経過 dtMs[ms] から1tick分を積分して内部 pose を更新し、それを返す
    next(cmd: Command, dtMs: number): Pose {
        return (this.pose = estimateStep(this.pose, cmd, dtMs, this.m));
    }
}
