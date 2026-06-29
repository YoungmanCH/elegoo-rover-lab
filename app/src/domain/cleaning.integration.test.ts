import { describe, it, expect } from "vitest";
import { step } from "./cleaning";
import { initialState, defaultConfig } from "../config";
import { advance, readSensors, defaultSimConfig } from "../sim/model";
import type { World, SimConfig } from "../sim/model";

function run(w0: World, ticks: number, sc: SimConfig = defaultSimConfig) {
    let st = initialState
    let w = w0;
    const log: { x: number; y: number; phase: string }[] = [];
    for (let i = 0; i < ticks; i++) {
        const { cmd, next } = step(readSensors(w, sc), st, defaultConfig);
        w = advance(w, cmd, sc);
        st = next;
        log.push({ x: w.pose.x, y: w.pose.y, phase: st.phase });
    }
    return{ log, sc };
}

describe("結合: 同じ brain をシムで回す", () => {
    it("広い部屋: 壁を貫通しない・首振りする・直進に戻り続ける(500tick)", () => {
        const { log, sc } = run({ pose: { x: 20, y: 75, yawDeg: 0 }, servoDeg: 90 }, 500);
        for (const p of log) {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(sc.roomW);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThanOrEqual(sc.roomH);
        }
        expect(log.some(p => p.phase === "scanLeft")).toBe(true);   // 壁で首振り
        expect(log.filter(p => p.phase === "drive").length).toBeGreaterThan(50);    // 直進にも居る
    });

    it("細い行き止まり: 突き当りで後退(reverse)して脱出する", () => {
        // 幅30の廊下を奥(+y)へ。突き当り付近で左右とも ~17cm(<openCm=30) → 両側塞がり → reverse。
        // 速度80=1.25cm/tick。y=10→突き当り判定(y>roomH-wallCm=60)まで約40tick。120tickで余裕。
        const sc: SimConfig = { ...defaultSimConfig, roomW: 30, roomH: 80 };
        const { log } = run({ pose: { x: 15, y: 10, yawDeg: 90 }, servoDeg: 90 }, 120, sc);
        expect(log.some(p => p.phase === "reverse")).toBe(true);
    });
});