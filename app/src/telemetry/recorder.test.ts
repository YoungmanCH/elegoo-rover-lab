import { describe, it, expect } from "vitest";
import { TrajectoryRecorder } from "./recorder";
import { createTrajectory } from "./trajectory";
import type { PoseSource } from "./pose-source";
import type { Pose, Command, Sensors, State, TrajectoryHeader } from "../types";
import { estimated, takeEstimate, type Estimated } from "../domain/estimated";

class FakePoseSource implements PoseSource {
    calls: { cmd: Command; dtMs: number}[] = [];
    constructor(private poses: Pose[]) {}
    next(cmd: Command, dtMs: number): Estimated<Pose> { 
        this.calls.push({ cmd, dtMs }); return estimated(this.poses[this.calls.length - 1]); 
    }
}
const clock = (ts: number[]) => { let i = 0; return () => ts[i++]; };   // 時刻を台本で渡す

const header = { v: 1 } as unknown as TrajectoryHeader;
const sensors: Sensors = { distanceCm: 48, yawDeg: 0, lifted: false };
const state: State = { 
    phase: "drive", 
    turnTicksLeft: 0, 
    leftCm: -1, 
    turnDir: "left", 
    reverseTicksLeft: 0 
};
const fwd: Command = { kind: "forward", speed: 80 };

function setup(times: number[], poses: Pose[]) {
    const traj = createTrajectory(header);
    const ps = new FakePoseSource(poses);
    const rec = new TrajectoryRecorder({
        now: clock(times),
        t0: times[0],
        poseSource: ps,
        traj,
        estimated: true,
        precision: 1,
    });
    return { traj, ps, rec };
}

describe("TrajectoryRecoder", () => {
    it("初回 onTick: t=0, dt=0, サンプル1件・estimated 伝播", () => {
        const { traj, rec } = setup([1000], [{ x: 1, y: 0, yawDeg: 0 }]);
        rec.onTick(state, sensors, fwd);
        expect(traj.size()).toBe(1);
        expect(traj.samples()[0]).toMatchObject({ t: 0, dt: 0, estimated: true, cmdKind: "forward" });
    });

    it("2回目: dt=時刻差・t 増加・PoseSource に (cmd, dt) を渡す", () => {
        const { traj, ps, rec } = setup(
            [1000, 1120], 
            [{ x: 1, y: 0, yawDeg: 0 }, { x: 2, y: 0, yawDeg: 0 }]
        );
        rec.onTick(state, sensors, fwd);
        rec.onTick(state, sensors, fwd);
        expect(ps.calls[1].dtMs).toBe(120);
        expect(traj.samples()[1].t).toBe(120);
        expect(takeEstimate(traj.samples()[1].pose)).toEqual({ x: 2, y: 0, yawDeg: 0 });
    });

    it("finish() で記録した Trajectory を返す", () => {
        const { traj, rec } = setup([1000], [{ x: 1, y: 0, yawDeg: 0 }]);
        rec.onTick(state, sensors, fwd);
        expect(rec.finish()).toBe(traj);
    });
});
