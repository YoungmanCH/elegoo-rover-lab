// ffmpeg-recorder.mjs — 録画の開始/停止の状態(状態機械)。spawn/fs/clock を注入＝実プロセス無しでテスト可。
import { ffmpegArgs } from "./ffmpeg-args.mjs";
import { videoFilename, sidecar } from "./recording-paths.mjs";

/**
 * @typedef {object} RecProc 録画プロセス(stdin に JPEG を流す)。
 * @property {{ write(b: Uint8Array): void, end(): void } | null} stdin
 */
/**
 * @typedef {object} RecControllerDeps
 * @property {(cmd: string, args: string[]) => RecProc} spawn  ffmpeg を起動(注入＝テストで fake)。
 * @property {(path: string, data: string) => void} writeFile  サイドカー書き出し(注入)。
 * @property {() => string} nowIso  ISO時刻(注入＝Date を内部で呼ばない)。
 * @property {string} outDir  出力ディレクトリ。
 */

/** @param {RecControllerDeps} deps */
export function createFfmpegRecorder(deps) {
    /** @type {RecProc | null} */
    let proc = null;
    return {
        isRecording: () => proc !== null,

        /**
         * @param {string} sessionId
         * @param {string} upstream
         * @returns {boolean} 開始できたか(録画中なら false)。
         */
        start(sessionId, upstream) {
            if (proc) return false;                                 // 二重起動を弾く
            deps.writeFile(
                `${deps.outDir}/${sessionId}.json`,
                JSON.stringify(sidecar(sessionId, deps.nowIso(), upstream)),
            );
            proc = deps.spawn(
                "ffmpeg", 
                ffmpegArgs(`${deps.outDir}/${videoFilename(sessionId)}`)
            );
            return true;
        },

        /** @param {Uint8Array} jpeg */
        writeFrame(jpeg) { proc?.stdin?.write(jpeg); },

        stop() { if (proc) { proc.stdin?.end(); proc = null; } },   // 確定して idle へ
    };
}


