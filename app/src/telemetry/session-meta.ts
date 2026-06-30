// session-meta.ts — sessionId とヘッダの生成。時刻は外から注入(内部で new Date しない=テスト容易)。
import type { TrajectoryHeader, Config, MotionModel, Pose } from "../types";

export function newSessionId(nowIso: string): string {
    return nowIso.replace(/[:.]/g, "-");
}

export function makeHeader(a: {
    sessionId: string; 
    startedAtIso: string;
    source: TrajectoryHeader["source"];
    config: Config;
    motionModel: MotionModel;
    pose0: Pose;
    videoFile?: string | null;
}): TrajectoryHeader {
    return { v: 1, ...a, videoFile: a.videoFile ?? null };
}
