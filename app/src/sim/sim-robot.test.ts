// sim-robot.test.ts — SimRobot が read/send で世界を正しく観測・更新するか
import { describe, it, expect } from "vitest";
import { SimRobot } from "./sim-robot";
import { defaultSimConfig } from "./model";
import type { World } from "./model";

const sc = defaultSimConfig;
const servoDefaultConfig = 90
const world = (x: number, y: number, yawDeg: number, servoDeg=servoDefaultConfig): World => ({ pose: { x, y, yawDeg }, servoDeg });

describe("SimRobot", () => {
    it("read は現在の姿勢からセンサを返す", async () => {
        const robot = new SimRobot(world(10, 75, 0), sc);
        const s = await robot.read();
        expect(s.distanceCm).toBeCloseTo(190);  // 200 - 10
        expect(s.yawDeg).toBe(0);
        expect(s.lifted).toBe(false);
    });

    it("send(forward) で世界が前進し、次の read に反映される", async () => {
        const robot = new SimRobot(world(10, 75, 0), sc);
        await robot.send({ kind: "forward", speed: 255});
        const s = await robot.read();
        expect(s.distanceCm).toBeCloseTo(186);  // x:14 → 200-14
    });

    it("send(stop) は世界を変えない", async () => {
        const robot = new SimRobot(world(10, 75, 0), sc);
        await robot.send({ kind: "stop", speed: 0 });
        expect(robot.getWorld().pose).toEqual({ x: 10, y: 75, yawDeg: 0 });
    });
});
