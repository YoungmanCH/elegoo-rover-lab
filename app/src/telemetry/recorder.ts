// recorder.ts — onTick を購読し sample 化して Trajectory に積むアプリ部品。
// now(時計)と poseSource を注入=実機/DOM 無しで完全にテストできる。
import type { State, Sensors, Command, TickObservation } from "../types";
import type { PoseSource } from "./pose-source";
import type { Trajectory } from "./trajectory";
import { makeSample } from "./sample";

export class TrajectoryRecorder {
    private last: number;
    constructor(private d: {
        now: () => number;
        t0: number;
        poseSource: PoseSource;
        traj: Trajectory;
        estimated: boolean;
        precision: number;
    }) { this.last = d.t0; };

    onTick(state: State, sensors: Sensors, cmd: Command): void {
        const now = this.d.now();
        const dt = now - this.last;
        this.last = now;
        const pose = this.d.poseSource.next(cmd, dt);

        // 観測を TickObservation に明示して組む（型注釈で取り違え・漏れを recorder 側で検出）。
        const obs: TickObservation = {
            t: now - this.d.t0,
            dt,
            cmd,
            sensors,
            phase: state.phase,
            pose,
            estimated: this.d.estimated,
        };
        this.d.traj.append(makeSample(obs, this.d.precision));
    }
    
    finish(): Trajectory { return this.d.traj; }
}