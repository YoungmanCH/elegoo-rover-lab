// recording-paths.mjs — 録画の出力名とサイドカー(純)。sessionId は stage7 と共有=動画と軌跡が対になる。

/**
 * @param {string} sessionId
 * @returns {string} 録画ファイル名。
*/
export function videoFilename(sessionId) {
    return `${sessionId}.mp4`;
}

/** @typedef {{ sessionId: string, startedAtIso: string, upstream: string, videoFile: string }} Sidecar */

/**
 * @param {string} sessionId
 * @param {string} startedAtIso
 * @param {string} upstream
 * @returns {Sidecar} 軌跡ログと突き合わせる同期メタ。
*/
export function sidecar(sessionId, startedAtIso, upstream) {
    return { sessionId, startedAtIso, upstream, videoFile: videoFilename(sessionId) };
}
