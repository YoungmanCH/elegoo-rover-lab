// kinematics.ts — 2D 剛体の運動学(純)。「回転 turnDeg → 向き後の前方へ moveCm」を適用するだけ。
// 壁での停止はここでは扱わない(部屋を持つ sim 側の責務)。シムも推定器もこの1式を共有する。
import type { Pose } from "../types";

export function integratePose(pose: Pose, moveCm: number, turnDeg: number): Pose {
    const yawDeg = pose.yawDeg + turnDeg;     // 先に回す
    const rad = (yawDeg * Math.PI) / 180;
    return {
        x: pose.x + Math.cos(rad) * moveCm,     // 回った後の向きへ進む
        y: pose.y + Math.sin(rad) * moveCm,
        yawDeg,
    };
}
