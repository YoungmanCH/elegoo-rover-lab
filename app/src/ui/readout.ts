// ui-readout.ts — 数値リードアウトの文字列を作る(純)。canvas は知らない＝単体テスト可。
import type { Pose } from "../types";
import { normalizeYaw } from "./geometry";

/** HUD の1行(X/Y/YAW/AIM/DIST)。distanceCm 省略時は DIST --。yaw は 0..359 表示。 */
export function formatReadout(
  pose: Pose,
  servoDeg: number,
  servoForwardDeg: number,
  distanceCm?: number,
): string {
  const yawN = normalizeYaw(pose.yawDeg);
  const aimOff = Math.round(servoDeg - servoForwardDeg);
  const aimSign = aimOff >= 0 ? "+" : "";
  const dist = distanceCm != null ? `${Math.round(distanceCm)}cm` : "--";
  return `X ${pose.x.toFixed(1)}  Y ${pose.y.toFixed(1)}  YAW ${yawN}°  AIM ${aimSign}${aimOff}°  DIST ${dist}`;
}
