import { describe, it, expect } from "vitest";
import { createTrajectory } from "./trajectory";
import type { TrajectoryHeader, TickSample } from "../types";
import { estimated } from "../domain/estimated";

const header = { v: 1, sessionId: "s1" } as unknown as TrajectoryHeader;
const sample = (t: number): TickSample => ({
    t,
    dt: 120,
    cmdKind: "forward",
    speed: 80,
    distanceCm: 50,
    lifted: false,
    phase: "drive",
    pose: estimated({ x: t, y: 0, yawDeg: 0 }),
    estimated: true,
});

describe("createTrajectory", () => {
    it("空で始まる", () => {
        expect(createTrajectory(header).size()).toBe(0);
    });

    it("append は順序を保ち size が増える", () => {
        const tr = createTrajectory(header);
        tr.append(sample(0));
        tr.append(sample(120));
        expect(tr.size()).toBe(2);
        expect(tr.samples().map((s) => s.t)).toEqual([0, 120]);
    });

    it("ヘッダを保持する", () => {
        expect(createTrajectory(header).header).toBe(header);
    });

    it("samples() のコピーを外から壊しても内部は不変", () => {
        const tr = createTrajectory(header);
        tr.append(sample(0));
        tr.samples().push(sample(999));     // 返り値を破壊してみる
        expect(tr.size()).toBe(1);          // 内部は守られる
    });
});
