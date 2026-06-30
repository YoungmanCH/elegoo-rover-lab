// control-url.ts — 録画開始/停止の制御URLを組む(純)。sessionId を proxy へ渡し動画名を揃える。
export function recControlUrl(
    controlUrl: string, 
    action: "start" | "stop", 
    sessionId: string
): string {
    return action === "start"
        ? `${controlUrl}/rec/start?session=${encodeURIComponent(sessionId)}`
        : `${controlUrl}/rec/stop`;
}
