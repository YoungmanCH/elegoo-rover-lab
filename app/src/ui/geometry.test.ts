import { describe, it, expect } from "vitest";
import {
  aimAngleDeg,
  polarPointCm,
  scaleFor,
  toPx,
  normalizeYaw,
} from "./geometry";
import { defaultSimConfig } from "../sim/model";

describe("aimAngleDeg（センサ実測方向＝readSensors と同規約）", () => {
  it("首が正面(servo=forward)なら yaw のまま", () => {
    expect(aimAngleDeg(0, 90, 90)).toBe(0);
    expect(aimAngleDeg(30, 90, 90)).toBe(30);
  });
  it("servo 150(+60)=左へ+60 / 30(-60)=右へ-60 オフセット", () => {
    expect(aimAngleDeg(0, 150, 90)).toBe(60);
    expect(aimAngleDeg(0, 30, 90)).toBe(-60);
  });
});

describe("polarPointCm（極座標→world cm。0度=+x, 90度=+y, 反時計+）", () => {
  it("0度へ d → +x", () => {
    expect(polarPointCm(0, 0, 0, 50)).toEqual({ x: 50, y: 0 });
  });

  it("90度へ → +y", () => {
    const p = polarPointCm(0, 0, 90, 50);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(50);
  });
  it("60度・50cm → (25, 43.3)", () => {
    const p = polarPointCm(0, 0, 60, 50);
    expect(p.x).toBeCloseTo(25);
    expect(p.y).toBeCloseTo(43.3, 1);
  });
  it("起点オフセットを足す", () => {
    expect(polarPointCm(10, 5, 0, 20)).toEqual({ x: 30, y: 5 });
  });
});

describe("scaleFor / toPx（cm↔px 投影）", () => {
  it("scaleFor: 部屋を canvas に収める最小倍率", () => {
    expect(scaleFor(600, 450, defaultSimConfig)).toBe(3); // min(600/200,450/150)
    expect(scaleFor(400, 450, defaultSimConfig)).toBe(2); // 幅側が制約
  });

  it("toPx: cm→px・y 反転(奥=上)", () => {
    expect(toPx(10, 75, defaultSimConfig, 3)).toEqual({ px: 30, py: 225 }); // (150-75)*3
    expect(toPx(0, 150, defaultSimConfig, 3)).toEqual({ px: 0, py: 0 }); // 奥端=上端
  });
});

describe("normalizeYaw（0..359 表示用）", () => {
  it("負・360超を畳む", () => {
    expect(normalizeYaw(0)).toBe(0);
    expect(normalizeYaw(-90)).toBe(270);
    expect(normalizeYaw(450)).toBe(90);
    expect(normalizeYaw(359.6)).toBe(0); // round(359.6)=360 → 0
  });
});
