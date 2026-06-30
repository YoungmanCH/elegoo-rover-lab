import { describe, it, expect } from "vitest";
import { estimateStep } from "./pose-estimator";
import type { Pose, MotionModel, Command } from "../types";

const mm: MotionModel = { 
    forwardCmPerSec: 20, 
    reverseCmPerSec: 20, 
    turnDegPerSec: 90,  
    refDriveSpeed: 80, 
    refTurnSpeed: 100 
};
const fwd: Command = { kind: "forward", speed: 80 };
const left: Command = { kind: "rotateLeft", speed: 100 };
const origin: Pose = { x: 0, y: 0, yawDeg: 0 };

describe("estimateStep（commandToDelta → integratePose の合成）", () => {
    it("forward → 向きへ前進", () => {
        expect(estimateStep(origin, fwd, 1000, mm).x).toBeCloseTo(20);
    });

    it("rotateLeft → yaw だけ増える", () => {
        const r = estimateStep(origin, left, 1000, mm);
        expect(r.yawDeg).toBeCloseTo(90);
        expect(r.x).toBeCloseTo(0);
    });

    it("stop → 不変", () => {
        expect(estimateStep(
            { x: 5, y: 6, yawDeg: 7 }, 
            { kind: "stop", speed: 0 }, 
            1000, 
            mm
        )).toEqual({ x: 5, y: 6, yawDeg: 7 });
    });
    
    it("正方形: [前進→左90度]×4 で始点へ戻る(連続合成の検証)", () => {
        let p = origin;
        for (let i = 0; i < 4; i++) {
            p = estimateStep(p, fwd, 1000, mm);     // 20 進む
            p = estimateStep(p, left, 1000, mm);    // 90度回る
        }
        expect(p.x).toBeCloseTo(0);
        expect(p.y).toBeCloseTo(0);
        expect(p.yawDeg).toBeCloseTo(360);
    });

    it("純粋: 入力 pose 不変", () => {
        const p = { ...origin };
        estimateStep(p, fwd, 1000, mm);
        expect(p).toEqual(origin);
    });
});

