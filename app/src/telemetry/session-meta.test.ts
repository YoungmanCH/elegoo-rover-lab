import { describe, it, expect } from "vitest";
import { newSessionId, makeHeader } from "./session-meta";
import type { Config, MotionModel } from "../types";

const cfg = { wallCm: 20 } as unknown as Config;    // 本テストでは中身を問わない(素通し)
const mm: MotionModel = { 
    forwardCmPerSec: 20, 
    reverseCmPerSec: 20, 
    turnDegPerSec: 90,
    refDriveSpeed: 80,
    refTurnSpeed: 100,
};

describe("newSessionId", () => {
    it("ISO の : と . を - に置換しファイル名安全にする", () => {
        expect(newSessionId("2026-06-28T12:00:00.000Z")).toBe("2026-06-28T12-00-00-000Z");
    });
});

describe("makeHeader", () => {
    it("引数を詰め v=1・videoFile 既定 null のヘッダを作る", () => {
        const h = makeHeader({
            sessionId: "s1",
            startedAtIso: "2026-06-28T12:00:00.000Z",
            source: "wifi",
            config: cfg,
            motionModel: mm,
            pose0: { x: 20, y: 75, yawDeg: 0 },
        });
        expect(h.v).toBe(1);
        expect(h.videoFile).toBeNull();
        expect(h.sessionId).toBe("s1");
        expect(h.config).toBe(cfg);     // 素通し(スナップショット) 
    });

    it("videoFile を渡せばそのまま保持する(動画連携の契約)", () => {
        const h = makeHeader({
            sessionId: "s1",
            startedAtIso: "2026-06-28T12:00:00.000Z",
            source: "wifi",
            config: cfg,
            motionModel: mm,
            pose0: { x: 20, y: 75, yawDeg: 0 },
            videoFile: "rec.mp4",
        });
        expect(h.videoFile).toBe("rec.mp4");    // a.videoFile ?? null の「指定時」分岐(既定 null の対)
    });
});
