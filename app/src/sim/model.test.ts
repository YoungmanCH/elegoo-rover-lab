// model.test.ts — 物理モデルの振る舞い仕様(Vitest)
import { describe, it, expect } from "vitest";
import { advance, readSensors, defaultSimConfig } from "./model";
import type  { World } from "./model";
import type { Command } from "../types";

const sc = defaultSimConfig; // 200×150, maxDrive=4, maxTurn=8

function world(x: number, y: number, yawDeg: number): World {
    return { pose: { x, y, yawDeg } };
}
const fwd = (speed: number): Command => ({ kind: "forward", speed });

describe("advance", () => {
    it("forward(yaw=0) → +x 方向へ maxDriveCmPerTick ぶん進む(speed=255)", () => {
        const w = advance(world(10, 75, 0), fwd(255), sc);
        expect(w.pose.x).toBeCloseTo(14);   // 10 + 4
        expect(w.pose.y).toBeCloseTo(75);   // 変化なし
    });

    it("forward は speed に比例(speed=128 ≒ 半分)", () => {
        const w = advance(world(10, 75, 0), fwd(128), sc);
        expect(w.pose.x).toBeCloseTo(10 + (128 / 255) * 4);
    });

    it("forward は壁を越えない(右端でクランプ)", () => {
        const w = advance(world(199, 75, 0), fwd(255), sc);
        expect(w.pose.x).toBe(200); // roomW で止まる
    });

    it("rotateLeft は yaw を増やす / rotateRight は減らす", () => {
        const l = advance(world(10, 10, 0), { kind: "rotateLeft", speed: 255}, sc);
        const r = advance(world(10, 10, 0), { kind: "rotateRight", speed: 255 }, sc);
        expect(l.pose.yawDeg).toBeCloseTo(8);   // +maxTurn
        expect(r.pose.yawDeg).toBeCloseTo(-8);  // -maxTurn
    });

    it("stop は姿勢を変えない", () => {
        const w = advance(world(10, 75, 30), { kind: "stop", speed: 0 }, sc);
        expect(w.pose).toEqual({ x: 10, y: 75, yawDeg: 30 });
    });

    it("純粋関数:入力 world を書き換えない", () => {
        const before = world(10, 75, 0);
        const snap = { pose: { ...before.pose } };
        advance(before, fwd(255), sc);
        expect(before).toEqual(snap);
    });
});

describe("readSensors", () => {
    it("前方(yaw=0)の壁まで距離 = roomW - x", () => {
        const s = readSensors(world(10, 75, 0), sc);
        expect(s.distanceCm).toBeCloseTo(190); // 200 - 10
    });

    it("後ろ向き(yaw=180)なら背後の壁(x=0)まで = x", () => {
        const s = readSensors(world(30, 75, 180), sc);
        expect(s.distanceCm).toBeCloseTo(30);
    });

    it("yaw と lifted をそのまま反映", () => {
        const s = readSensors(world(10, 75, 45), sc);
        expect(s.lifted).toBe(false);
    })
});
