import { describe, it, expect } from "vitest";
import { isOpen, clearance, chooseEscape } from "./scan-decision";
import type { EscapeParams } from "./scan-decision";
// import type { Config } from "../types";

const params = (o: Partial<EscapeParams> = {}): EscapeParams => ({ openCm: 30, turnDir: "left", ...o });

// const config = (o: Partial<Config> = {}): Config => ({
//     wallCm: 20,
//     turnTicks: 6,
//     turnDir: "left",
//     driveSpeed: 80,
//     turnSpeed: 100,
//     tickMs: 120,
//     liftStop: false,
//     scanLeftDeg: 150,
//     scanRightDeg: 30,
//     scanCenterDeg: 90,
//     openCm: 30,
//     reverseSpeed: 80,
//     reverseTicks: 3,
//     turnTick180: 12,
//     ...o,
// });

describe("isOpen", () => {
    it("0(エコー無し)は空き", () => expect(isOpen(0, 30)).toBe(true));
    it("openCm 未満は塞がり", () => expect(isOpen(29, 30)).toBe(false));
    it("openCm ちょうど/以上は空き", () => {
        expect(isOpen(30, 30)).toBe(true);
        expect(isOpen(100, 30)).toBe(true);
    });
});

describe("clearance", () => {
    it("エコー無し(0)は最も遠い扱い(Infinity)", () => expect(clearance(0)).toBe(Infinity));
    it("正の距離はそのまま", () => expect(clearance(40)).toBe(40));
});

// 並びは chooseEscape の分岐順(両塞→片側空き→両側空き)に合わせる。
describe("chooseEscape", () => {
    // 左右とも壁。どちらにも曲がれないので後退する(左右の値の大小は無関係)。
    it("両側とも壁(不等) → reverse", () => expect(chooseEscape(10, 13, params())).toBe("reverse"));
    it("両側とも壁(同値) → reverse", () => expect(chooseEscape(10, 10, params())).toBe("reverse"));
    it("両側とも壁(片方が閾値ぎりぎり下) → reverse", () => expect(chooseEscape(29, 5, params())).toBe("reverse"));
    
    // 片側だけ空いている → 空いている側へ。
    it("左だけ空き → left", () => expect(chooseEscape(50, 10, params())).toBe("left"));
    it("右だけ空き → right", () => expect(chooseEscape(10, 50, params())).toBe("right"));
    
    // 両側空き → 壁が遠い(広い)方へ。
    it("両方空き → 広い方(右)", () => expect(chooseEscape(40, 90, params())).toBe("right"));
    it("両方空き → 広い方(左)", () => expect(chooseEscape(90, 40, params())).toBe("left"));
    it("同点 → 既定方向(left)", () => expect(chooseEscape(50, 50, params())).toBe("left"));
    it("同点 → 既定方向(right)", () => expect(chooseEscape(50, 50, params({ turnDir: "right" }))).toBe("right"));
    it("0(無限遠)は最も広い → そちらへ", () => expect(chooseEscape(0, 80, params())).toBe("left"));
});
