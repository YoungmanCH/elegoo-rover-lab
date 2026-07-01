// sonar.ts — 実測距離を robot 中心のサンプルにする(純)。位置に積分しない=ドリフトしない・嘘を描かない。
import type { SonarSample } from "../types";

/** tick の実測から robot 相対サンプルを作る。エコー無し(0)/範囲外は null(=実測が無い=描かない)。
 *  距離は実測、方向は首の指令(servoDeg・no feedback)。 */
export function toSonarSample(
    servoDeg: number,
    servoForwardDeg: number,
    distanceCm: number,
    t: number,
    maxCm: number,
): SonarSample | null {
    if (distanceCm <= 0 || distanceCm > maxCm) return null;   // 0=エコー無し/範囲外は捨てる
    return { relDeg: servoDeg - servoForwardDeg, distanceCm, t };
}

/** 直近 windowMs の実測だけ残す(古い測定は落とす。世界座標に積分しない)。 */
export function pruneSonar(
    samples: SonarSample[], 
    nowT: number, 
    windowMs: number
): SonarSample[] {
    return samples.filter((s) => nowT - s.t <= windowMs);
}
