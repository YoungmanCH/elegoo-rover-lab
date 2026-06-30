import { describe, it, expect } from "vitest";
import { formatReadout } from "./readout";
import type { Pose } from "../types";

const pose = (x: number, y: number, yawDeg: number): Pose => ({ x, y, yawDeg });

describe("formatReadout", () => {
  it("X/Y/YAW/AIM/DIST を整形(servo=forward→AIM +0)", () => {
    expect(formatReadout(pose(20, 75, 0), 90, 90, 48)).toBe(
      "X 20.0  Y 75.0  YAW 0°  AIM +0°  DIST 48cm",
    );
  });
  it("distance 省略 → DIST --", () => {
    expect(formatReadout(pose(0, 0, 0), 90, 90)).toBe(
      "X 0.0  Y 0.0  YAW 0°  AIM +0°  DIST --",
    );
  });
  it("yaw を 0..359 正規化・aim 符号", () => {
    expect(formatReadout(pose(0, 0, -90), 150, 90, 10)).toBe(
      "X 0.0  Y 0.0  YAW 270°  AIM +60°  DIST 10cm",
    );
    expect(formatReadout(pose(0, 0, 0), 30, 90)).toContain("AIM -60°");
  });
});
