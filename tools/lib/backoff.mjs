// backoff.mjs — 再接続の待ち時間(指数バックオフ・上限つき)を出す(純)。
/** @param {number} attempt @param {number} baseMs @param {number} maxMs @returns {number} */
export function backoffMs(attempt, baseMs, maxMs) {
    return Math.min(maxMs, baseMs * 2 ** attempt);
}
