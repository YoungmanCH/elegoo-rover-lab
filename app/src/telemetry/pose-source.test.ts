import { describe, it, expect } from "vitest";
import { SimPoseSource, EstimatorPoseSource } from "./pose-source";
import { takeEstimate } from "../domain/estimated";
import type { MotionModel, Command } from "../types";

const mm: MotionModel = { 
    forwardCmPerSec: 20,
    reverseCmPerSec: 20,
    turnDegPerSec: 90,
    refDriveSpeed: 80,
    refTurnSpeed: 100
};

const stop: Command = { kind: "stop", speed: 0 };
const fwd: Command = { kind: "forward", speed: 80 };

describe("SimPoseSource（真値）", () => {
    it("シムの現在 pose をそのまま返す", () => {
        const sim = { getWorld: () => ({ pose: { x: 1, y: 2, yawDeg: 3 } }) };
        expect(takeEstimate(new SimPoseSource(sim).next(stop, 100))).toEqual({ x: 1, y: 2, yawDeg: 3 });
    });
});

describe("EstimatorPoseSource（推定・状態を持つ）", () => {
    it("呼ぶたびに estimateStep で前進していく", () => {
        const src = new EstimatorPoseSource({ x: 0, y: 0, yawDeg: 0 }, mm);
        expect(takeEstimate(src.next(fwd, 1000)).x).toBeCloseTo(20);
        expect(takeEstimate(src.next(fwd, 1000)).x).toBeCloseTo(40);      // 累積
    });
});
