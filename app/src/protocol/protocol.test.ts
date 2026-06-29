// protocol.test.ts — シリアル文字列との相互変換の仕様(Vitest)
import { describe, it, expect } from "vitest";
import { 
    encodeCommand, 
    encodeQueryDistance, 
    encodeQueryLifted, 
    encodeQueryYaw, 
    encodeServo,
    parseFrame, 
    decodeDistance, 
    decodeYaw, 
    decodeLifted 
} from "./protocol";

describe("encodeCommand", () => {
    it("forward → N=3 D1=3, H は文字列", () => {
        const obj = JSON.parse(encodeCommand({ kind: "forward", speed: 120 }, "1"));
        expect(obj).toMatchObject({ H: "1", N: 3, D1: 3, D2: 120 });
        expect(typeof obj.H).toBe("string");    // 数値だとファームが読めない
    });

    it("reverse → N=3 D1=4", () => {
        expect(
            JSON.parse(encodeCommand({ kind: "reverse", speed: 80 }, "1"))
        ).toMatchObject({ N: 3, D1: 4, D2: 80 });
    });

    it("rotateLeft → D1=1 / rotateRight → D1=2", () => {
        expect(
            JSON.parse(encodeCommand({ kind: "rotateLeft", speed: 150 }, "1"))
        ).toMatchObject({ N: 3, D1: 1 });
        expect(
            JSON.parse(encodeCommand({ kind: "rotateRight", speed: 150 }, "1"))
        ).toMatchObject({ N: 3, D1: 2});
    });

    it("stop → N=4 D1=0 D2=0 (確実停止)", () => {
        expect(
            JSON.parse(encodeCommand({ kind: "stop", speed: 0 }, "1"))
        ).toMatchObject({ N: 4, D1: 0, D2: 0 });
    });
});

describe("encodeQuery*", () => {
    it("distance は N=21 D1=2", () => {
        expect(JSON.parse(encodeQueryDistance("21"))).toMatchObject({ N: 21, D1: 2 });
    });

    it("lifted は N=23 / yaw は N=24", () => {
        expect(JSON.parse(encodeQueryLifted("23"))).toMatchObject({ N: 23 });
        expect(JSON.parse(encodeQueryYaw("24"))).toMatchObject({ N: 24 });
    });
});

describe("encodeServo", () => {
    it("encodeServo → N=5 D1=1 D2=angle, H は文字列", () => {
        const o = JSON.parse(encodeServo(150, "5"));
        expect(o).toMatchObject({ H: "5", N:5, D1: 1, D2: 150 });
        expect(typeof o.H).toBe("string");
    });
});

describe("parseFrame", () => {
    it("{21_45} → h=21, payload=45", () => {
        expect(parseFrame("{21_45}")).toEqual({ h: "21", payload: "45" });
    });

    it("負の値/真偽も取れる", () => {
        expect(parseFrame("{24_-12.5}")).toEqual({ h: "24", payload: "-12.5" });
        expect(parseFrame("{23_true}")).toEqual({ h: "23", payload: "true" });
    });

    it("形式外は null", () => {
        expect(parseFrame("ok")).toBeNull();
        expect(parseFrame("{bad}")).toBeNull();
    });
});

describe("decode", () => {
    it("distance を数値化", () => expect(decodeDistance("45")).toBe(45));
    it("yaw を数値化(負・小数)", () => expect(decodeYaw("-12.5")).toBeCloseTo(-12.5));

    it("★lifted は反転: 接地 true → false / 離地 false → true", () => {
        expect(decodeLifted("true")).toBe(false);   // 接地＝持ち上げではない
        expect(decodeLifted("false")).toBe(true);   // 離地＝持ち上げ
    });
});
