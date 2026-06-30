// mjpeg-demux.mjs — MJPEG のバイト列から JPEG フレームを切り出す(純・状態あり)。
// JPEG は SOI(FF D8)〜EOI(FF D9)。エントロピー中の生 FF は FF00 にスタッフィングされ FF D9 は EOI のみ。
// boundary 文字列は ASCII で非ASCIIの SOI/EOI と衝突しないので無視してよい。
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/** @typedef {{ buf: Buffer }} DemuxState 未完成バイトを溜める状態。 */

/** @returns {DemuxState} 新しい空の状態。 */
export function createDemux() {
    return { buf: Buffer.alloc(0) };
}

/**
 * バイト列から完成した JPEG フレームを切り出す。
 * @param {DemuxState} state 前回までの未完バイト。
 * @param {Buffer} chunk 新たに届いたバイト列。
 * @returns {{ frames: Buffer[], state: DemuxState }} 完成フレーム列と次状態。
*/
export function extractFrames(state, chunk) {
    let buf = Buffer.concat([state.buf, chunk]);
    /** @type {Buffer[]} */
    const frames = [];
    for (;;) {
    // 【停止性の不変条件】各反復は必ず (a)break する か (b)buf を厳密に縮める のどちらか。
    //  SOI無し→break / EOI無し→buf=buf.subarray(soi)で末尾へ縮め break / 完成→buf=buf.subarray(eoi+2)で前進。
        const soi = buf.indexOf(SOI);
        if (soi < 0) {
            // SOI 未到来。次チャンク先頭が D8 で SOI になり得るので末尾の単独 FF だけ残す。
            buf = buf.length > 0 && buf[buf.length - 1] === 0xff 
                ? buf.subarray(buf.length - 1) 
                : Buffer.alloc(0);
            break;
        }
        const eoi = buf.indexOf(EOI, soi + 2);
        if (eoi < 0) { buf = buf.subarray(soi); break; }    // フレーム未完。SOI から残す
        frames.push(buf.subarray(soi, eoi + 2));
        buf = buf.subarray(eoi + 2);
    }
    return { frames, state: { buf } };
}
