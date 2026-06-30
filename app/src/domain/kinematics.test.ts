// kinematics.test.ts — 運動学カーネルの振る舞い仕様。
import { describe, it, expect } from "vitest";
import { integratePose } from "./kinematics";
import type { Pose } from "../types";

const pose = (x: number, y: number, yawDeg: number): Pose => ({ x, y, yawDeg });

describe("integratePose（回転→並進の純粋カーネル）", () => {
    it("yaw=0 で前進 → +x に move ぶん進む(向き不変)", () => {
        expect(integratePose(pose(10, 75, 0), 10, 0)).toEqual({ x: 20, y: 75, yawDeg: 0 });
    });

    it("後退(move 負) → 逆向きへ", () => {
        expect(integratePose(pose(10, 75, 0), -10, 0)).toEqual({ x: 0, y: 75, yawDeg: 0 });
    });

    it("回転のみ(move=0) → yaw だけ増える(位置不変)", () => {
        expect(integratePose(pose(10, 75, 0), 0, 30)).toEqual({ x: 10, y: 75, yawDeg: 30 });
    });

    it("回転してから前進(順序: 先に回る)", () => {
        const r = integratePose(pose(10, 75, 0), 10, 90);   // 90度回って +y へ
        expect(r.yawDeg).toBe(90);
        expect(r.x).toBeCloseTo(10);
        expect(r.y).toBeCloseTo(85);
    });

    it("壁でクランプしない(部屋を知らない=sim の責務)", () => {
        expect(integratePose(pose(195, 75, 0), 100, 0).x).toBe(295);    // 200 を越えても止めない
    });

    it("yaw は折り返さない(連続値)", () => {
        expect(integratePose(pose(0, 0, 350), 0, 30).yawDeg).toBe(380);
    });

    it("純粋関数: 入力 pose を破壊しない", () => {
        const p = pose(10, 75, 0);
        const snap = { ...p };
        integratePose(p, 10, 45);
        expect(p).toEqual(snap);
    });
});
