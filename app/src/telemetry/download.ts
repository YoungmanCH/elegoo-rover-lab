// download.ts — 保存。純部分(ファイル名)だけ切り出してテスト、Blob/<a> 副作用は smoke。
export function recordingFilename(sessionId: string, ext: "ndjson" | "csv"): string {
    return `trajectory-${sessionId}.${ext}`;
}

export function downloadText(filename: string, text: string, mime: string): void {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}
