// motion-model.ts — 指令と実経過 dt から「この間の移動量cm・回転量deg」を出す。
// 速度(PWM)は基準値に対して線形と近似(ラフ。校正で吸収)。数値は MotionModel から受ける。
import type { Command, MotionModel } from "../types";

export function commandToDelta(cmd: Command, dtMs: number, m: MotionModel): { moveCm: number; turnDeg: number } {
    const sec = dtMs / 1000;
    switch (cmd.kind) {
        case "forward":
            return { moveCm: m.forwardCmPerSec * (cmd.speed / m.refDriveSpeed) * sec, turnDeg: 0 };
        case "reverse":
            return { moveCm: -m.reverseCmPerSec * (cmd.speed / m.refDriveSpeed) * sec, turnDeg: 0 };
        case "rotateLeft":
            return { moveCm: 0, turnDeg: +m.turnDegPerSec * (cmd.speed / m.refTurnSpeed) * sec };
        case "rotateRight":
            return { moveCm: 0, turnDeg: -m.turnDegPerSec * (cmd.speed / m.refTurnSpeed) * sec };
        case "stop":
            return { moveCm: 0, turnDeg: 0 };
    }
}
