// robot.ts — ロボット入出力の契約(read/send だけ)。実機・シムが各々これを実装する。
import type { Sensors, Command } from "../types";

export interface RobotIO {
    /** 入力: 現在のセンサ値を1ティック分(制御ループの1周期)読む。 */
    read(): Promise<Sensors>;

    /** 出力: 駆動指令を送る。 */
    send(cmd: Command): Promise<void>;
}