import { describe, it, expect } from "vitest";
import { SimRobot } from "../sim/sim-robot";
import { defaultSimConfig } from "../sim/model";
import { defaultConfig, initialState, defaultMotionModel } from "../config";
import { step } from "../domain/cleaning";
import { createTrajectory } from "./trajectory";
import { makeHeader } from "./session-meta";
import { SimPoseSource } from "./pose-source";
import { TrajectoryRecorder } from "./recorder";
import { toNDJSON } from "./serialize";
import { takeEstimate } from "../domain/estimated";

describe("結合: シムを回すと空でない・往復可能な軌跡が出る", () => {
    it("20tick 回す → 21行NDJSON・全行 valid JSON・pose が動いている", async () => {
        const sim = new SimRobot(
            { pose: {x: 20, y: 75, yawDeg: 0 }, servoDeg: 90 }, 
            defaultSimConfig
        );
        const ps = new SimPoseSource(sim);
        let t = 0;
        const now = () => (t += 120);           // 120ms 刻みの擬似時計
        const traj = createTrajectory(makeHeader({
            sessionId: "it",
            startedAtIso: "x",
            source: "sim",
            config: defaultConfig,
            motionModel: defaultMotionModel,
            pose0: { x: 20, y: 75, yawDeg: 0 },
        }));
        const rec = new TrajectoryRecorder({ 
            now, 
            t0: 0, 
            poseSource: ps, 
            traj, 
            estimated: false, 
            precision: 1 
        });

        let st = initialState;
        for (let i = 0; i < 20; i++) {
            const sensors = await sim.read();
            const { cmd, next } = step(sensors, st, defaultConfig);
            await sim.send(cmd);                                            // Wolrdを進める
            rec.onTick(next, sensors, cmd);                                 // ★send 後の真値 pose を記録
            st = next;
        }       

        expect(traj.size()).toBe(20);
        const lines = toNDJSON(traj).trim().split("\n");
        expect(lines.length).toBe(21);                                      // header + 20
        expect(() => lines.forEach((l) => JSON.parse(l))).not.toThrow();    // 往復可能
        expect(traj.samples().some((s) => takeEstimate(s.pose).x !== 20 || takeEstimate(s.pose).y !== 75)).toBe(true);    // 実際に動いた
    });
});
