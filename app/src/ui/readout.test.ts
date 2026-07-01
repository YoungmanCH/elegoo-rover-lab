import { describe, it, expect } from "vitest";
import { formatSensorReadout } from "./readout";

describe("formatSensorReadout（実測のみ・推定X/Yを出さない）", () => {
    it("距離/首角(指令)/離地/指令を出す", () => {
        expect(formatSensorReadout(48, 90, 90, false, "forward"))
            .toBe("DIST 48cm  AIM +0°  GND  CMD forward");
    })

    it("エコー無し(0)は DIST --", () => {
        expect(formatSensorReadout(0, 90, 90, false, "stop"))
            .toBe("DIST --  AIM +0°  GND  CMD stop");
    });

    it("首の指令方向で AIM 符号 / 離地", () => {
        expect(formatSensorReadout(20, 30, 90, true, "rotateRight"))
            .toBe("DIST 20cm  AIM -60°  LIFTED  CMD rotateRight");
    });
});
