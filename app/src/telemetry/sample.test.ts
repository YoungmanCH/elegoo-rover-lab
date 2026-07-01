import { describe, it, expect } from "vitest";
import { makeSample } from "./sample";
import type { Command, Sensors, State } from "../types";
import { estimated, takeEstimate } from "../domain/estimated";

const base = {
    t: 120,
    dt: 120,
    cmd: { kind: "forward", speed: 80 } as Command,
    sensors: { distanceCm: 48, yawDeg: 0, lifted: false } as Sensors,
    phase: "drive" as State["phase"],
    pose: estimated({ x: 1.2345, y: 2.7, yawDeg: 90.04 }),
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
        expect(takeEstimate(makeSample(base, 1).pose)).toEqual({ x: 1.2, y: 2.7, yawDeg: 90 });
    });

    it("純粋: 入力を壊さない", () => {
        const before = takeEstimate(base.pose);
        makeSample(base, 1);
        expect(takeEstimate(base.pose)).toEqual(before);
    });
});
