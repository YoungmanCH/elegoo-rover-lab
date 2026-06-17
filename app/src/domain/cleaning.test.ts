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
        wallCm: 20, turnTicks: 3, turnDir: "left",
        driveSpeed: 120, turnSpeed: 150, tickMs: 120, liftStop: false, ...over,
    };
}

const drive: State = { phase: "drive", turnTicksLeft: 0 };

describe("step(タイマ旋回)", () => {
    it("drive中・壁が遠い → 直進を継続(drive のまま)", () => {
        const r = step(sensors({ distanceCm: 50 }), drive, config());
        expect(r.cmd).toEqual({ kind: "forward", speed: 120 });
        expect(r.next).toEqual({ phase: "drive", turnTicksLeft: 0 });
    });

    it("drive中・壁に到達(左回り) → 左旋回を開始し turn へ(turnTicks をセット)", () => {
        const r = step(sensors({ distanceCm: 10 }), drive, config({ turnTicks: 3 }));
        expect(r.cmd).toEqual({ kind: "rotateLeft", speed: 150 });
        expect(r.next).toEqual({ phase: "turn", turnTicksLeft: 3 });
    });

    it("drive中・壁に到達(右回り) → 右旋回を開始", () => {
        const r = step(sensors({ distanceCm: 10 }), drive, config({ turnDir: "right" }));
        expect(r.cmd.kind).toBe("rotateRight");
        expect(r.next.phase).toBe("turn");
    });

    it("drive中・距離0(エコー無し=遠い) → 壁とみなさず直進", () => {
        const r = step(sensors({ distanceCm: 0 }), drive, config());
        expect(r.cmd).toEqual({ kind: "forward", speed: 120 });
        expect(r.next.phase).toBe("drive");
    });

    it("turn中・残りtickあり → 旋回を継続し残りtickを1減らす", () => {
        const turning: State = { phase: "turn", turnTicksLeft: 3 };
        const r = step(sensors({ distanceCm: 10 }), turning, config());
        expect(r.cmd).toEqual({ kind: "rotateLeft", speed: 150 });
        expect(r.next).toEqual({ phase: "turn", turnTicksLeft: 2 });
    });

    it("turn中・残り1tick → 直進に戻る(drive へ)", () => {
        const turning: State = { phase: "turn", turnTicksLeft: 1 };
        const r = step(sensors({ distanceCm: 10 }), turning, config());
        expect(r.cmd).toEqual({ kind: "forward", speed: 120 });
        expect(r.next).toEqual({ phase: "drive", turnTicksLeft: 0 });
    });

    it("持ち上げ → 停止(liftStop=true のとき・相は保持)", () => {
        const turning: State = { phase: "turn", turnTicksLeft: 2 };
        const r = step(sensors({ lifted: true }), turning, config({ liftStop: true }));
        expect(r.cmd).toEqual({ kind: "stop", speed: 0 });
        expect(r.next).toEqual(turning);  // 相は変えない
    });

    it("純粋関数: 入力の state を書き換えない", () => {
        const turning: State = { phase: "turn", turnTicksLeft: 3 };
        const snapshot = { ...turning };
        step(sensors({ distanceCm: 10 }), turning, config());
        expect(turning).toEqual(snapshot);  // 元の state は不変
    });
});
