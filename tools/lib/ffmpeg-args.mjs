// ffmpeg-args.mjs — 連結JPEG(stdin)→mp4 録画の ffmpeg 引数を組む(純)。値は呼び元から(ハードコーディングしない)。

/**
 * @typedef {object} FfmpegOpts
 * @property {string} [codec]  映像コーデック(既定 libx264)。
 * @property {string} [pixFmt] ピクセルフォーマット(既定 yuv420p)。
*/

/**
 * @param {string} outPath 出力 mp4 のパス。
 * @param {FfmpegOpts} [opts]
 * @returns {string[]} ffmpeg の引数列。
*/
export function ffmpegArgs(outPath, opts = {}) {
    const { codec = "libx264", pixFmt = "yuv420p" } = opts;
    return [
        "-f", "mjpeg",
        "-use_wallclock_as_timestamps", "1",   // 可変fpsでも実時間どおりの再生速度に
        "-i", "pipe:0",
        "-c:v", codec,
        "-pix_fmt", pixFmt,
        "-movflags", "+faststart",
        "-y", outPath,
    ];
}

