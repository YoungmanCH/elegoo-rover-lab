import { describe, it, expect } from "vitest";
import { makeSample } from "./sample";
import type { Command, Sensors, State, Pose } from "../types";

const base = {
    t: 120,
    dt: 120,
    cmd: { kind: "forward", speed: 80 } as Command,
    sensors: { distanceCm: 48, yawDeg: 0, lifted: false } as Sensors,
    phase: "drive" as State["phase"],
    pose: { x: 1.2345, y: 2.7, yawDeg: 90.04 } as Pose,
    estimated: true,
}

describe("makeSample", () => {
    it("観測値を TickSample のフィールドに対応づける", () => {
        expect(makeSample(base, 1)).toMatchObject({
            t: 120,
            dt: 120,
            cmdKind: "forward",
            speed: 80,
            distanceCm: 48,
            lifted: false,
            phase: "drive",
            estimated: true,
        });
    });

    it("pose を precision 桁に丸める(桁は config 由来=ハードコーディングしない)", () => {
        expect(makeSample(base, 1).pose).toEqual({ x: 1.2, y: 2.7, yawDeg: 90 });
    });

    it("純粋: 入力を壊さない", () => {
        const snap = JSON.parse(JSON.stringify(base));
        makeSample(base, 1);
        expect(base).toEqual(snap);
    });
});
