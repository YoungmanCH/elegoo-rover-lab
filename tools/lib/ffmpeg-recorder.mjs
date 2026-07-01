// ffmpeg-recorder.mjs — 録画の開始/停止の状態(状態機械)。spawn/fs/clock を注入＝実プロセス無しでテスト可。
import { ffmpegArgs } from "./ffmpeg-args.mjs";
import { videoFilename, sidecar } from "./recording-paths.mjs";

/**
 * @typedef {object} RecProc 録画プロセス(stdin に JPEG を流す)。
 * @property {{ write(b: Uint8Array): void, end(): void } | null} stdin
 */
/**
 * @typedef {object} RecDeps
 * @property {(dir: string) => void} ensureDir  出力dirを保証(書き込み前)。★これが無くて ENOENT だった
 * @property {(cmd: string, args: string[]) => RecProc} spawn
 * @property {(path: string, data: string) => void} writeFile
 * @property {() => string} nowIso
 * @property {string} outDir
 */
/** @param {RecDeps} deps */
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
            deps.ensureDir(deps.outDir);                            // ENOENT回避
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


