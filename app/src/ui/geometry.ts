// ui-geometry.ts — 描画用の幾何(純)。角度・極座標だけ。canvas/DOM は知らない＝単体テスト可。
// センサ方向は model.ts の readSensors と同一規約: 実方向 = pose.yawDeg + (servoDeg - servoForwardDeg)。
// 式を変えるときは readSensors と必ず揃える。
import type { SimConfig } from "../sim/model";

/** センサ(首)の実測方向[度]。world系・0=+x・反時計回りが+。 */
export function aimAngleDeg(
  yawDeg: number,
  servoDeg: number,
  servoForwardDeg: number,
): number {
  return yawDeg + (servoDeg - servoForwardDeg);
}

/** 点(x,y)[cm]から angleDeg 方向へ distCm 進んだ点[cm]（world系）。 */
export function polarPointCm(
  x: number,
  y: number,
  angleDeg: number,
  distCm: number,
): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: x + Math.cos(rad) * distCm, y: y + Math.sin(rad) * distCm };
}

/** 部屋(cm)を Canvas(px) に収める拡大率。 */
export function scaleFor(
  canvasW: number,
  canvasH: number,
  sc: SimConfig,
): number {
  return Math.min(canvasW / sc.roomW, canvasH / sc.roomH);
}

/** cm座標 → Canvas px座標。y は反転(奥=上 を 画面の上方向 へ)。 */
export function toPx(
  x: number,
  y: number,
  sc: SimConfig,
  scale: number,
): { px: number; py: number } {
  return { px: x * scale, py: (sc.roomH - y) * scale };
}

/** 角度を 0..359 に正規化(表示用)。 */
export function normalizeYaw(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}
