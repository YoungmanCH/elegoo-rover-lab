import { describe, it, expect } from "vitest";
import { toNDJSON, toCSV } from "./serialize";
import { createTrajectory } from "./trajectory";
import type { TrajectoryHeader, TickSample } from "../types";

const header = { v: 1, sessionId: "s1" } as unknown as TrajectoryHeader;
const sample = (t: number): TickSample => ({
    t,
    dt: 120,
    cmdKind: "forward",
    speed: 80,
    distanceCm: 50,
    lifted: false,
    phase: "drive",
    pose: { x: t, y: 0, yawDeg: 0},
    estimated: true,
});

function withSamples(n: number) {
    const tr = createTrajectory(header);
    for (let i = 0; i < n; i++) tr.append(sample(i * 120));
    return tr;
}

describe("toNDJSON", () => {
    it("1行目=header, 以降=tick, 行数 = 1 + 件数", () => {
        const lines = toNDJSON(withSamples(2)).trim().split("\n");
        expect(lines.length).toBe(3);
        expect(JSON.parse(lines[0]).type).toBe("header");
        expect(JSON.parse(lines[1]).type).toBe("tick");
    });

    it("往復(round-trip): tick 行を parse すると元サンプルに戻る", () => {
        const tr = withSamples(1);
        const back = JSON.parse(toNDJSON(tr).trim().split("\n")[1]);
        expect(back).toMatchObject({ type: "tick", ...tr.samples()[0] });   // 取りこぼし無し
    });

    it("空 Trajectory → ヘッダ1行だけ", () => {
        expect(toNDJSON(createTrajectory(header)).trim().split("\n").length).toBe(1);
    });
});

describe("toCSV", () => {
    it("ヘッダ行が列定義と一致", () => {
        expect(toCSV(withSamples(1)).trim().split("\n")[0])
            .toBe("t,dt,cmdKind,speed,distanceCm,lifted,phase,x,y,yawDeg,estimated");
    });

    it("各行のセル数 = ヘッダ列数(列ズレ防止の不変条件)", () => {
        const rows = toCSV(withSamples(3)).trim().split("\n");
        const n = rows[0].split(",").length;
        for (const r of rows) expect(r.split(",").length).toBe(n);
    });

    it("空 Trajectory → ヘッダ行のみ", () => {
        expect(toCSV(createTrajectory(header)).trim().split("\n").length).toBe(1);
    });
});
