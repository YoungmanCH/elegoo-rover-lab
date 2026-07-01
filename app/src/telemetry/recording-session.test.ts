import { describe, it, expect } from "vitest";
import { createRecordingSession } from "./recording-session";
import type { PoseSource } from "./pose-source";
import { estimated, takeEstimate, type Estimated } from "../domain/estimated";
import type { Pose, State, Sensors, Command, Config, MotionModel } from "../types";

// 注入する fake 群（DOM も時計も実 Date も使わない＝決定論的）
class FakePoseSource implements PoseSource {
    private i = 0;
    constructor(private poses: Pose[]) {}
    next(): Estimated<Pose> { return estimated(this.poses[this.i++]); }
}
const clock = (ts: number[]) => { let i = 0; return () => ts[i++]; };       // 時刻を台本で渡す

const cfg = { wallCm: 20 } as unknown as Config;            // ヘッダ素通しなので中身は問わない
const mm: MotionModel = { 
    forwardCmPerSec: 20,
    reverseCmPerSec: 20,
    turnDegPerSec: 90,
    refDriveSpeed: 80,
    refTurnSpeed: 100,
};
const sensors: Sensors = { distanceCm: 48, yawDeg: 0, lifted: false };
const state = { phase: "drive" } as State;                  // makeSample が読むのは phase だけ
const fwd: Command = { kind: "forward", speed: 80 };
const pose0: Pose = { x: 0, y: 0, yawDeg: 0 };

function setup(times: number[], poses: Pose[]) {
    const saved: { filename: string; text: string; mime: string }[] = [];
    const rec = createRecordingSession({
        now: clock(times),
        nowIso: () => "2026-06-28T12:00:00.000Z",           // 固定（session-meta と同じ「時計は注入」流儀）
        precision: 1,
        config: cfg,
        download: (filename, text, mime) => saved.push({ filename, text, mime }),
    });
    const start = (recordVideo = false) => rec.start({ 
        poseSource: new FakePoseSource(poses),
        estimated: true,
        source: "wifi",
        motionModel: mm,
        pose0,
        recordVideo
    });
    return { rec, saved, start };
}

describe("createRecordingSession", () => {
    it("start 前: tick は null・active=false（＝描かない）", () => {
        const { rec } = setup([], []);
        expect(rec.active).toBe(false);
        expect(rec.tick(state, sensors, fwd)).toBeNull();
    });

    it("start→tick: 軌跡(pose列)を返し active=true", () => {
        const { rec, start } = setup([1000, 1100], [{ x: 1, y: 0, yawDeg: 0 }]);
        start();
        expect(rec.active).toBe(true);
        expect(rec.tick(state, sensors, fwd)?.map(takeEstimate)).toEqual([{ x: 1, y: 0, yawDeg: 0 }]);
    });

    it("複数 tick で軌跡が累積する", () => {
        const { rec, start } = setup(
            [1000, 1100, 1200], 
            [{ x: 1, y: 0, yawDeg: 0 }, { x: 2, y: 0, yawDeg: 0 }],
        );
        start();
        rec.tick(state, sensors, fwd);
        const trail = rec.tick(state, sensors, fwd);
        expect(trail).toHaveLength(2);
        expect(takeEstimate(trail![1])).toEqual({ x: 2, y: 0, yawDeg: 0 });
    });

    it("saveNDJSON: 注入 download に (ファイル名, NDJSON, mime) を渡す・往復可能", () => {
        const { rec, saved, start } = setup(
            [1000, 1100],
            [{ x: 1, y: 0, yawDeg: 0 }],
        );
        start();
        rec.tick(state, sensors, fwd);
        rec.saveNDJSON();
        expect(saved).toHaveLength(1);
        expect(saved[0].filename).toContain("2026-06-28T12-00-00-000Z");    // newSessionId 由来(: . → -)
        expect(saved[0].filename).toMatch(/\.ndjson$/);
        expect(saved[0].mime).toBe("application/x-ndjson");
        const lines = saved[0].text.trim().split("\n").map((l) => JSON.parse(l));
        expect(lines[0].type).toBe("header");
        expect(lines).toHaveLength(2);                                      // header + 1 tick
    });

    it("recordVideo:true → ヘッダ videoFile=<sessionId>.mp4／sessionId を公開（stage8 同期）", () => {
        const { rec, saved, start } = setup([1000, 1100], [{x: 1, y: 0, yawDeg: 0 }]);
        start(true);
        rec.tick(state, sensors, fwd);
        rec.saveNDJSON();
        const header = JSON.parse(saved[0].text.trim().split("\n")[0]);     // 先頭=ヘッダ行
        expect(rec.sessionId).toBe("2026-06-28T12-00-00-000Z");             // カメラ録画に渡す id
        expect(header.videoFile).toBe("2026-06-28T12-00-00-000Z.mp4");      // 軌跡⇔動画の紐付け
    });

    it("save 前(未開始)は download を呼ばない（ガード）", () => {
        const { rec, saved } = setup([], []);
        rec.saveNDJSON();
        rec.saveCSV();
        expect(saved).toHaveLength(0);
    });

    it("this 非依存: メソッドを裸で渡しても動く（コールバック用途）", () => {
        const { rec, saved, start } = setup(
            [1000, 1100], 
            [{ x: 1, y: 0, yawDeg: 0 }]
        );
        start();
        rec.tick(state, sensors, fwd);
        const handler = rec.saveNDJSON;         // レシーバから外して渡す
        handler();
        expect(saved).toHaveLength(1);          // class なら this 外れて壊れる。factory は通る
    });

    it("再 start で前の記録を畳んで差し替える（新規 traj・空から積む）", () => {
        const { rec, start } = setup(
            [1000, 1100, 2000, 2100],
            [{ x: 1, y: 0, yawDeg: 0 }, { x: 9, y: 9, yawDeg: 0 }],
        );
        start();
        rec.tick(state, sensors, fwd);
        start();                            // やり直し
        expect(rec.tick(state, sensors, fwd)).toHaveLength(1);      // 新記録は空から
    });
});
