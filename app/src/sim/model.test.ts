// model.test.ts — 物理モデルの振る舞い仕様(Vitest)
import { describe, it, expect } from "vitest";
import { advance, readSensors, defaultSimConfig } from "./model";
import type  { World } from "./model";
import type { Command } from "../types";

const sc = defaultSimConfig; // 200×150。移動量/回転量は sc.maxDrive/maxTurn 由来で導出（調整に追従＝直書きしない）
const defaultServoDeg = 90;

function world(x: number, y: number, yawDeg: number, servoDeg=defaultServoDeg): World {
    return { pose: { x, y, yawDeg }, servoDeg };
}
const fwd = (speed: number): Command => ({ kind: "forward", speed });
const rev = (speed: number): Command => ({ kind: "reverse", speed });

describe("advance", () => {
    it("forward(yaw=0) → +x 方向へ maxDriveCmPerTick ぶん進む(speed=255)", () => {
        const w = advance(world(10, 75, 0), fwd(255), sc);
        expect(w.pose.x).toBeCloseTo(10 + sc.maxDriveCmPerTick);   // speed255 で maxDrive ぶん
        expect(w.pose.y).toBeCloseTo(75);       // 変化なし
    });

    it("forward は speed に比例(speed=128 ≒ 半分)", () => {
        const w = advance(world(10, 75, 0), fwd(128), sc);
        expect(w.pose.x).toBeCloseTo(10 + (128 / 255) * sc.maxDriveCmPerTick);
    });

    it("forward は壁を越えない(右端でクランプ)", () => {
        const w = advance(world(199, 75, 0), fwd(255), sc);
        expect(w.pose.x).toBe(200);             // roomW で止まる
    });

    it("reverse(yaw=0) → -x 方向へ進む", () => {
        const w = advance(world(50, 75, 0), rev(255), sc);
        expect(w.pose.x).toBeCloseTo(50 - sc.maxDriveCmPerTick);   // 後退も同量
    });

    it("reverse は speed に比例", () => {
        const w = advance(world(50, 75, 0), rev(128), sc);
        expect(w.pose.x).toBeCloseTo(50 - (128 / 255) * sc.maxDriveCmPerTick);
    });

    it("reverse は壁を越えない(左端でクランプ)", () => {
        const w = advance(world(1, 75, 0), rev(255), sc);
        expect(w.pose.x).toBe(0);               // 0 でクランプ
    });

    it("aimDeg は servoDeg を更新し、姿勢は変えない(stop時)", () => {
        const w = advance(world(50, 75, 0), { kind: "stop", speed: 0, aimDeg: 150 }, sc);
        expect(w.servoDeg).toBe(150);
        expect(w.pose).toEqual({ x: 50, y: 75, yawDeg: 0 });
    });

    it("aimDeg 省略時は servoDeg を保つ", () => {
        const w = advance(world(50, 75, 0, 150), { kind: "forward", speed: 255 }, sc);
        expect(w.servoDeg).toBe(150);
    });

    it("首を左(150=正面+60)に向けると左の壁までを測る", () => {
        // 部屋50×50, 中央(25,25), yaw=0(右向き), 首150→ +60度方向へレイキャスト
        const s = readSensors(world(25, 25, 0, 150), { ...sc, roomW: 50, roomH: 50 });
        expect(s.distanceCm).toBeGreaterThan(0);    // 上(奥)の壁までの斜め距離
    });

    it("rotateLeft は yaw を増やす / rotateRight は減らす", () => {
        const l = advance(world(10, 10, 0), { kind: "rotateLeft", speed: 255}, sc);
        const r = advance(world(10, 10, 0), { kind: "rotateRight", speed: 255 }, sc);
        expect(l.pose.yawDeg).toBeCloseTo(sc.maxTurnDegPerTick);    // +maxTurn
        expect(r.pose.yawDeg).toBeCloseTo(-sc.maxTurnDegPerTick);   // -maxTurn
    });

    it("stop は姿勢を変えない", () => {
        const w = advance(world(10, 75, 30), { kind: "stop", speed: 0 }, sc);
        expect(w.pose).toEqual({ x: 10, y: 75, yawDeg: 30 });
    });

    it("純粋関数:入力 world を書き換えない", () => {
        const before = world(10, 75, 0);
        const snap = structuredClone(before);
        advance(before, fwd(255), sc);
        expect(before).toEqual(snap);
    });
});

const sc50 = { ...sc, roomW: 50, roomH: 50 };

describe("readSensors", () => {
    it("正面(servo90)は前方の壁まで", () => {
        expect(readSensors(world(25, 25, 0), sc50).distanceCm).toBeCloseTo(25);     // 右壁 50-25
    })

    it("左を見る(servo150=正面+60度)→斜め前の壁まで", () => {
        expect(readSensors(world(25, 25, 0, 150), sc50).distanceCm).toBeCloseTo(28.87, 1);
    });

    it("右を見る(servo30=正面-60度)→対称で同じ距離", () => {
        expect(readSensors(world(25, 25, 0, 30), sc50).distanceCm).toBeCloseTo(28.87, 1);
    })

    it("前方(yaw=0)の壁まで距離 = roomW - x", () => {
        const s = readSensors(world(10, 75, 0), sc);
        expect(s.distanceCm).toBeCloseTo(190); // 200 - 10
    });

    it("後ろ向き(yaw=180)なら背後の壁(x=0)まで = x", () => {
        const s = readSensors(world(30, 75, 180), sc);
        expect(s.distanceCm).toBeCloseTo(30);
    });

    it("yaw と lifted をそのまま反映", () => {
        const s = readSensors(world(10, 75, 45), sc);
        expect(s.lifted).toBe(false);
    });
});
