// recording-session.ts — 記録セッションの寿命・状態・直列化を1単位に閉じる(注入でテスト可)。
// 不変条件: 同時に生きる記録は最大1つ。start で前を畳んで新規へ差し替える(RobotSession と同じ作法)。
import type { 
    Pose, 
    State, 
    Sensors, 
    Command, 
    Config, 
    MotionModel, 
    TrajectoryHeader 
} from "../types";
import type { Estimated } from "../domain/estimated";
import type { PoseSource } from "./pose-source";
import type { Trajectory } from "./trajectory";
import { createTrajectory } from "./trajectory";
import { TrajectoryRecorder } from "./recorder";
import { newSessionId, makeHeader } from "./session-meta";
import { toNDJSON, toCSV } from "./serialize";
import { recordingFilename } from "./download";

/** 副作用と時計は注入＝DOM/実 Date 無しでテストできる。 */
export type RecordingDeps = {
    now: () => number;                                                  // 時計[ms]（recorder の dt 計測にも使う）
    nowIso: () => string;                                               // ISO 時刻（内部で Date を呼ばない）
    precision: number;                                                  // pose 丸め桁（config 由来）
    config: Config;                                                     // ヘッダに残す実行時 config
    download: (filename: string, text: string, mime: string) => void;   // 保存の副作用
};

/** 記録開始時の「その回固有」の文脈。具象選択(sim/実機)は合成点 main が決めて渡す。 */
export type StartArgs = {
    poseSource: PoseSource;                                             // 真値(Sim) or 推定(Estimator)
    estimated: boolean;                                                 // sim=false / 実機=true
    source: TrajectoryHeader["source"];                                 // "sim" | "usb" | "wifi"（ヘッダ用ラベル）
    motionModel: MotionModel;                                           // ヘッダに残す校正
    pose0: Pose;                                                        // 開始姿勢
    recordVideo?: boolean;                                              // 動画も録るか（stage8 同期。既定 false）
}

export function createRecordingSession(d: RecordingDeps) {
    let recorder: TrajectoryRecorder | null = null;                     // ← クロージャで真に private
    let traj: Trajectory | null = null;
    let id = "";

    function save(ext: "ndjson" | "csv", to: (t: Trajectory) => string, mime: string): void {
        if (!recorder) return;                                          // 未開始は何もしない(ガード)
        d.download(recordingFilename(id, ext), to(recorder.finish()), mime);
    }

    return {
        /** 記録中か(描画分岐・保存ボタン活性に使える)。 */
        get active(): boolean { return recorder !== null; },

        /** 発行した sessionId（カメラ録画を同じ id で起動・動画名導出に使う＝stage8 同期）。 */
        get sessionId(): string { return id; },

        /** 記録を開始(前があれば破棄して差し替え)。以後 tick が積む。 */
        start(a: StartArgs): void {
            const startedAtIso = d.nowIso();
            id = newSessionId(startedAtIso);
            const t0 = d.now();
            const videoFile = a.recordVideo ? `${id}.mp4` : null;        // 動画名は id から導出(Node の videoFilename と一致)
            traj = createTrajectory(makeHeader({
                sessionId: id,
                startedAtIso,
                source: a.source,
                videoFile,
                config: d.config,
                motionModel: a.motionModel,
                pose0: a.pose0,
            }));
            recorder = new TrajectoryRecorder({
                now: d.now,
                t0,
                poseSource: a.poseSource,
                traj,
                estimated: a.estimated,
                precision: d.precision,
            });
        },

        /** 1tick 記録し、描画用の軌跡(pose列)を返す。未開始なら null(=描かない)。 */
        tick(state: State, sensors: Sensors, cmd: Command): Estimated<Pose>[] | null {
            if (!recorder || !traj) return null;
            recorder.onTick(state, sensors, cmd);
            return traj.samples().map((s) => s.pose);
        },

        saveNDJSON(): void { save("ndjson", toNDJSON, "application/x-ndjson"); },
        
        saveCSV(): void { save("csv", toCSV, "text/csv"); },
    };
}

/** 公開型は実装から導出。 */
export type RecordingSession = ReturnType<typeof createRecordingSession>;
