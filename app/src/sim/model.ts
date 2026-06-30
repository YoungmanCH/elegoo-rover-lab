// model.ts — 2Dシミュレータの物理(純粋)。姿勢の更新とセンサ観測だけを担う。
//
// World            … 仮想世界の状態(ロボットの姿勢)。部屋は SimConfig の矩形で表す。
// advance()        … 1ティック分、指令に従って姿勢を進める。
// readSensors()    … 現在の姿勢から Sensors(前方距離/yaw/離地)を作る。
import type { Sensors, Command, Pose } from "../types";
import { integratePose } from "../domain/kinematics";



/** 仮想世界の状態。姿勢＋首の向き(90=正面)。 */
export type World = { pose: Pose; servoDeg: number }; 

/** シムの物理パラメータ(仮想世界の設定)。config.ts とは責務が別。 */
export type SimConfig = {
    /** 部屋の幅 [cm](x: 0〜roomW)。 */
    roomW: number;

    /** 部屋の奥行き [cm](y: 0〜roomH)。 */
    roomH: number;

    /** speed=255 のとき1ティックで進む距離 [cm]。 */
    maxDriveCmPerTick: number;

    /** speed=255 のとき1ティックで回る角度 [度]。 */
    maxTurnDegPerTick: number;

    /** 首の正面角[度]。config.scanCenterDeg と一致させる(ハードコード排除)。 */
    servoForwardDeg: number;
}

/** 既定のシム設定(200×150cm の部屋)。 */
export const defaultSimConfig: SimConfig = {
    roomW: 200,
    roomH: 150,
    maxDriveCmPerTick: 4,
    maxTurnDegPerTick: 8,
    servoForwardDeg: 90,
}

/** 値を [min, max] に収める小ヘルパ。 
 * clamp: はみ出した値を範囲の端で止める（→壁で止まる）
 * v: 座標・速度を想定
*/
function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

/**
 * 1ティック分、指令に従って姿勢を進める(純関数:入力 world は壊さない)。
 *   forward     … 向いている方向へ前進(部屋の外には出ない＝壁で止まる)
 *   rotateLeft  … yaw を + 方向(反時計回り)へ
 *   rotateRight … yaw を − 方向(時計回り)へ
 *   stop        … 何もしない
 */
export function advance(w: World, cmd: Command, sc: SimConfig): World {
    const servoDeg = cmd.aimDeg ?? w.servoDeg;          // 首は独立に反映(省略時は保持)

    if (cmd.kind === "forward" || cmd.kind === "reverse") {
        const sign = cmd.kind === "forward" ? 1: -1;
        const move = sign * (cmd.speed / 255) * ( sc.maxDriveCmPerTick);
        const p = integratePose(w.pose, move, 0);
        return {
            servoDeg,
            pose: {
                x: clamp(p.x, 0, sc.roomW),
                y: clamp(p.y, 0, sc.roomH),
                yawDeg: p.yawDeg,
            },
        };
    }

    if (cmd.kind === "rotateLeft" || cmd.kind === "rotateRight") {
        const a = (cmd.speed / 255) * sc.maxTurnDegPerTick;
        const dir = cmd.kind === "rotateLeft" ? 1 : -1;
        return { servoDeg, pose: integratePose(w.pose, 0, dir * a)}; // 連続値(折り返さない)
    }

    return { servoDeg, pose: w.pose };       // stop: 姿勢そのまま・首だけ反映
}

/** 現在の姿勢から Sensors を観測する。離地はシムでは常に false。 */
export function readSensors(w: World, sc: SimConfig): Sensors {
    const aimOffset = w.servoDeg - sc.servoForwardDeg;      // 90→0, 150→+60(左), 30→-60(右)
    return {
        distanceCm: frontDistance(w.pose, aimOffset, sc),
        yawDeg: w.pose.yawDeg,
        lifted: false,
    };
}

/**
 * 前方の壁までの距離 [cm]。部屋は軸並行の矩形なので、
 * 内部の点から出る向きへの「箱の出口」までの距離を求める(レイキャスト)。
 * 要するに「部屋は単純な長方形だから、ロボットの位置から前方へ線を伸ばして
 * “どの壁を最初に突き抜けるか＝その距離”を求めている（レイキャスト）」
 */
function frontDistance(p: Pose, aimOffset: number, sc: SimConfig): number {
    const rad = ((p.yawDeg + aimOffset) * Math.PI) / 180;
    const dx = Math.cos(rad);  // 向きの x成分(右へどれだけ進むか)
    const dy = Math.sin(rad);  // 向きの y成分(奥へどれだけ進むか)
    let best = Infinity;

    // 4枚の壁(x=0, x=roomW, y=0, y=roomH)それぞれまでの距離を計算し、
    // 「向いている側の壁」だけ候補にして、一番近いものを採用する
    if (dx > 0) best = Math.min(best, (sc.roomW - p.x) / dx); // 右を向いてる→右の壁まで
    if (dx < 0) best = Math.min(best, (0 - p.x) / dx);        // 左を向いてる→左の壁まで
    if (dy > 0) best = Math.min(best, (sc.roomH - p.y) / dy); // 奥を向いてる→奥の壁まで
    if (dy < 0) best = Math.min(best, (0 - p.y) / dy);        // 手前→手前の壁まで

    return best; // 矩形は凸＝最小の正の t が前方の壁
}
