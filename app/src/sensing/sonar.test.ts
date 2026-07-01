import { describe, it, expect } from "vitest";
import { toSonarSample, pruneSonar } from "./sonar";
import type { SonarSample } from "../types";

describe("toSonarSample（実測距離+指令方向。無効は null）", () => {
    it("有効: relDeg=servo-forward・距離はそのまま", () => {
        expect(toSonarSample(150, 90, 48, 100, 150)).toEqual({ 
            relDeg: 60, 
            distanceCm: 48, 
            t: 100 
        });
        expect(toSonarSample(30, 90, 20, 5, 150)).toEqual({ 
            relDeg: -60, 
            distanceCm: 20, 
            t: 5 
        });
    });

    it("エコー無し(0)は null(捏造しない)", () => {
        expect(toSonarSample(90, 90, 0, 100, 150)).toBeNull();
    });

    it("範囲外(>maxCm)は null", () => {
        expect(toSonarSample(90, 90, 200, 100, 150)).toBeNull();
    });
});

describe("pruneSonar（積分しない=直近だけ残す）", () => {
    const s = (t: number): SonarSample => ({ relDeg: 0, distanceCm: 30, t });
    it("windowMs 内は残し、古いものは落とす", () => {
        expect(pruneSonar([s(0), s(500), s(1000)], 1200, 1000).map((x) => x.t)).toEqual([500, 1000]);
    });

    it("境界(ちょうど windowMs)は残す", () => {
        expect(pruneSonar([s(200)], 1200, 1000).length).toBe(1);
    })
});
