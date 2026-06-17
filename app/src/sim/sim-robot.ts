// sim-robot.ts — model を RobotIO として実装するシム。世界の状態を内部に持つ。
import type { RobotIO } from "../io/robot";
import type { Sensors, Command } from "../types";
import type { World, SimConfig } from "./model";
import { advance, readSensors, defaultSimConfig } from "./model";

export class SimRobot implements RobotIO {
    private world: World;
    private sc: SimConfig;

    constructor(initial: World, sc: SimConfig = defaultSimConfig) {
        this.world = initial;
        this.sc = sc;
    }

    /** 現在の姿勢からセンサ値を観測(即解決)。 */
    async read(): Promise<Sensors> {
        return readSensors(this.world, this.sc);
    }

    /** 指令で世界を1ティック進める。 */
    async send(cmd: Command): Promise<void> {
        this.world = advance(this.world, cmd, this.sc);
    }

    /** 描画用に現在の世界を覗く(読み取り専用の用途)。
    *  ※RobotIO の契約外。シムだと知っている描画側だけが使う。 */
    getWorld(): World {
        return this.world;
    }
}
