// cleaning.test.ts — step() の純ロジックを検証(タイマ旋回版)
import { describe, it, expect } from "vitest";
import { step } from "./cleaning";
import type { Sensors, State, Config } from "../types";

// テスト用センサ(必要な値だけ over で上書き。既定は「床・前方100cm・正立」)
function sensors(over: Partial<Sensors> = {}): Sensors {
    return { distanceCm: 100, yawDeg: 0, lifted: false, ...over };
}

// テスト用設定(turnTicks=3・左回りを既定に。over で上書き)
function config(over: Partial<Config> = {}): Config {
    return {
        wallCm: 20, 
        turnTicks: 6,
        turnDir: "left",
        driveSpeed: 80, 
        turnSpeed: 100, 
        tickMs: 120, 
        liftStop: false,
        scanLeftDeg: 150,
        scanRightDeg: 30,
        scanCenterDeg: 90,
        openCm: 30,
        reverseSpeed: 80,
        reverseTicks: 3,
        turnTicks180: 12, 
        ...over,
    };
}

function drive(over: Partial<State> = {}): State  {
    return { phase: "drive", turnTicksLeft: 0, leftCm: -1, turnDir: "left", reverseTicksLeft: 0, ...over };
}

describe("step(スキャン)", () => {
    it("drive: 壁が遠い → forward(継続)", () => {
        const r = step(sensors({ distanceCm: 50 }), drive(), config());
        expect(r.cmd).toEqual({ kind: "forward", speed: 80 });
        expect(r.next.phase).toBe("drive");
    });

    it("drive: 距離0(エコー無し=遠い) → 壁とみなさず直進", () => {
        expect(step(sensors({ distanceCm: 0 }), drive(), config()).cmd.kind).toBe("forward");
    });

    it("drive: 壁 → 停止して首を左へ・scanLeft へ", () => {
        const r = step(sensors({ distanceCm: 10 }), drive(), config());
        expect(r.cmd).toEqual({ kind: "stop", speed: 0, aimDeg: 150 });
        expect(r.next).toMatchObject({ phase: "scanLeft", leftCm: -1 });
    });

    it("scanLeft: 左を測ったら記録して首を右へ・scanRight へ", () => {
        const r = step(sensors({ distanceCm: 55 }), drive({ phase: "scanLeft" }), config());
        expect(r.cmd).toEqual({ kind: "stop", speed: 0, aimDeg: 30 });
        expect(r.next).toMatchObject({ phase: "scanRight", leftCm: 55 });
    });

    it("scanRight: 両側とも壁 → 後退して reverse相へ・首は正面へ戻す", () => {
        const r = step(sensors({ distanceCm: 12 }), drive({ phase: "scanRight", leftCm: 10 }), config());
        expect(r.cmd).toEqual({ kind: "reverse", speed: 80, aimDeg: 90 });
        expect(r.next).toMatchObject({ phase: "reverse", reverseTicksLeft: 3, turnDir: "left" });
    });

    it("scanRight: 左が空き右が壁 → 左へ旋回開始・首は正面へ戻す", () => {
        const r = step(sensors({ distanceCm: 10 }), drive({ phase: "scanRight", leftCm: 80 }), config());
        expect(r.cmd).toEqual({ kind: "rotateLeft", speed: 100, aimDeg: 90 });
        expect(r.next).toMatchObject({ phase: "turn", turnDir: "left", turnTicksLeft: 6 });
    });

    it("scanRight: 右が空き左が壁 → 右へ旋回", () => {
        const r = step(sensors({ distanceCm: 80 }), drive({ phase: "scanRight", leftCm: 10 }), config());
        expect(r.cmd.kind).toBe("rotateRight");
        expect(r.next).toMatchObject({ phase: "turn", turnDir: "right" });
    });

    it("reverse: 後退の残りが2以上 → 後退を続ける", () => {
        const r = step(sensors(), drive({ phase: "reverse", reverseTicksLeft: 3 }), config());
        expect(r.cmd.kind).toBe("reverse");
        expect(r.next.reverseTicksLeft).toBe(2);
    });

    it("reverse: 後退の残りが1以下 → 180度旋回へ(turnTicks180)", () => {
        const r = step(sensors(), drive({ phase: "reverse", reverseTicksLeft: 1, turnDir: "left" }), config());
        expect(r.cmd.kind).toBe("rotateLeft");
        expect(r.next).toMatchObject({ phase: "turn", turnTicksLeft: 12 });
    });

    it("turn: 旋回の残りが2以上 → 続ける / 1以下 → forward(drive復帰)", () => {
        expect(step(sensors(), drive({ phase: "turn", turnTicksLeft: 6, turnDir: "left" }), config()).next.turnTicksLeft).toBe(5);
        expect(step(sensors(), drive({ phase: "turn", turnTicksLeft: 1, turnDir: "left" }), config()).cmd.kind).toBe("forward");
    });

    it("持ち上げ（離地） → 停止(liftStop=true のとき・相は保持)", () => {
        const st = drive({ phase: "scanRight", leftCm: 40 });
        const r = step(sensors({ lifted: true }), st, config({ liftStop: true }));
        expect(r.cmd).toEqual({ kind: "stop", speed: 0 });
        expect(r.next).toEqual(st);
    });

    it("純粋関数: 入力の state を書き換えない", () => {
        const st = drive({ phase: "turn", turnTicksLeft: 6, turnDir: "left" });
        const snap = structuredClone(st);
        step(sensors({ distanceCm: 10 }), st, config());
        expect(st).toEqual(snap);
    });
});
