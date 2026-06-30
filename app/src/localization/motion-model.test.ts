import { describe, it, expect } from "vitest";
import { commandToDelta } from "./motion-model";
import type { MotionModel, Command } from "../types";

const mm = (over: Partial<MotionModel> = {}): MotionModel => ({
    forwardCmPerSec: 20, 
    reverseCmPerSec: 20,
    turnDegPerSec: 90,
    refDriveSpeed: 80,
    refTurnSpeed: 100,
    ...over,
});

const cmd = (kind: Command["kind"], speed: number): Command => ({ kind, speed });

describe("commandToDelta（dt と速度で移動量を決める）", () => {
    it("forward・基準速・dt=1000ms → moveCm=forwardCmPerSec, turnDeg=0", () => {
        expect(commandToDelta(cmd("forward", 80), 1000, mm())).toEqual({ moveCm: 20, turnDeg: 0 });
    });

    it("rotateLeft → turnDeg 正・moveCm=0", () => {
        expect(commandToDelta(cmd("rotateLeft", 100), 1000, mm())).toEqual({ moveCm: 0, turnDeg: 90 });
    });

    it("rotateRight → turnDeg 負", () => {
        expect(commandToDelta(cmd("rotateRight", 100), 1000, mm()).turnDeg).toBeCloseTo(-90);
    });

    it("reverse → moveCm 負・turnDeg=0", () => {
        expect(commandToDelta(cmd("reverse", 80), 1000, mm())).toEqual({ moveCm: -20, turnDeg: 0 });
    });

    it("stop → {0,0}", () => {
        expect(commandToDelta(cmd("stop", 0), 1000, mm())).toEqual({ moveCm: 0, turnDeg: 0 });
    });

    it("dt 線形: dt 2倍 → 量も2倍", () => {
        expect(commandToDelta(cmd("forward", 80), 2000, mm()).moveCm).toBeCloseTo(40);
    });

    it("速度スケール: 基準の半分のPWM → 量も半分", () => {
        expect(commandToDelta(cmd("forward", 40), 1000, mm()).moveCm).toBeCloseTo(10);
    });
});
