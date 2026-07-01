import { describe, it, expect } from "vitest";
import { simMotionFromModel } from "./model";
import type { MotionModel } from "../types";

describe("simMotionFromModel（実測 cm/s・deg/s → sim per-tick(speed255基準)）", () => {
    it("forward: cm/s × tick秒 × 255/refDrive", () => {
        const m: MotionModel = { 
            forwardCmPerSec: 22,
            reverseCmPerSec: 22,
            turnDegPerSec: 125,
            refDriveSpeed: 80,
            refTurnSpeed: 100,
        };
        const r = simMotionFromModel(m, 120);
        expect(r.maxDriveCmPerTick).toBeCloseTo(8.415);     // 22*0.12*255/80
        expect(r.maxTurnDegPerTick).toBeCloseTo(38.25);     // 125*0.12*255/100
    });

    it("tickMs / 基準PWM に比例", () => {
        const m: MotionModel = { 
            forwardCmPerSec: 10,
            reverseCmPerSec: 10,
            turnDegPerSec: 100,
            refDriveSpeed: 255,
            refTurnSpeed: 255,
        };
        const r = simMotionFromModel(m, 1000);     // 1秒・基準255 → per-tick = 実測そのもの
        expect(r.maxDriveCmPerTick).toBeCloseTo(10);
        expect(r.maxTurnDegPerTick).toBeCloseTo(100); 
    });
});

