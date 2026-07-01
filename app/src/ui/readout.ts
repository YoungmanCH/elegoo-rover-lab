// ui-readout.ts — 数値リードアウトの文字列を作る(純)。
import type { Command } from "../types";

/** 実測のみのリードアウト(推定 X/Y は出さない)。distance 0=エコー無しは "--"。 */
export function formatSensorReadout(
    distanceCm: number,
    servoDeg: number,
    servoForwardDeg: number,
    lifted: boolean,
    cmdKind: Command["kind"],
): string {
    const aim = Math.round(servoDeg - servoForwardDeg);
    const dist = distanceCm > 0 ? `${Math.round(distanceCm)}cm` : "--";
    return `DIST ${dist}  AIM ${aim >= 0 ? "+" : ""}${aim}°  ${lifted ? "LIFTED" : "GND"}  CMD ${cmdKind}`;
}
