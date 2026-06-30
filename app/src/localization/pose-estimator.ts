// pose-estimator.ts — 推測航法(dead-reckoning)。指令+実dt で Pose を1tick進める(純)。
// モデルベース: commandToDelta(校正) → integratePose(運動学カーネル)。ドリフトする=推定。
import type { Pose, Command, MotionModel } from "../types";
import { commandToDelta } from "./motion-model";
import { integratePose } from "../domain/kinematics";

export function estimateStep(pose: Pose, cmd: Command, dtMs: number, m: MotionModel): Pose {
    const { moveCm, turnDeg } = commandToDelta(cmd, dtMs, m);
    return integratePose(pose, moveCm, turnDeg);
}
