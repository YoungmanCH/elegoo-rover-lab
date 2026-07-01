import { describe, it, expect } from "vitest";
import { sonarLayout, sonarPointPx, fadeAlpha, nextServoDeg } from "./geometry";

describe("nextServoDeg（実機コーンが指令方向へ追従）", () => {
    it("aimDeg 指定時はそれに追従", () => {
        expect(nextServoDeg(90, 150)).toBe(150);
        expect(nextServoDeg(150, 30)).toBe(30);
    });

    it("aimDeg 未指定(undefined)は前回を保持", () => {
        expect(nextServoDeg(150, undefined)).toBe(150);
    });
});

describe("sonarLayout（canvas→中心/スケール）", () => {
    it("中心=canvas/2・scale=(min半径-余白)/maxRange", () => {
        expect(sonarLayout(500, 500, 150, 8)).toEqual({ 
            cx: 250, 
            cy: 250, 
            scale: (250 -16) / 150 
        });
        expect(sonarLayout(600, 400, 100, 0)).toEqual({ 
            cx: 300, 
            cy: 200, 
            scale: 200 / 100
        });   // 縦(400/2=200)が制約 → 半径200 / maxRange100 = 2
    });
});

describe("sonarPointPx（0=上・+左=反時計。符号バグ検出）", () => {
    const at = (relDeg: number) => sonarPointPx(relDeg, 50, 100, 100, 1);
    it("relDeg=0 → 真上", () => { 
        const p = at(0);
        expect(p.px).toBeCloseTo(100);
        expect(p.py).toBeCloseTo(50);
    });

    it("relDeg=+90(左) → 真左", () => {
        const p = at(90);
        expect(p.px).toBeCloseTo(50);
        expect(p.py).toBeCloseTo(100);
    });

    it("relDeg=-90(右) → 真右", () => {
        const p = at(-90);
        expect(p.px).toBeCloseTo(150);
        expect(p.py).toBeCloseTo(100);
    });
});

describe("fadeAlpha（古さ→不透明度・新しいほど濃い", () => {
    it("最新は最も濃い(min+span)", () => {
        expect(fadeAlpha(1000, 1000, 1500, 0.15, 0.85)).toBeCloseTo(1.0);
    });
    
    it("fadeMs 経過で最も薄い(min)", () => {
        expect(fadeAlpha(2500, 1000, 1500, 0.15, 0.85)).toBeCloseTo(0.15);
    });

    it("半分経過は中間", () => {
        expect(fadeAlpha(1750, 1000, 1500, 0.15, 0.85)).toBeCloseTo(0.575);     // 0.15+0.85*0.5
    });
    
    it("未来/超過はクランプ", () => {
        expect(fadeAlpha(500, 1000, 1500, 0.15, 0.85)).toBeCloseTo(1.0);
    });
});
