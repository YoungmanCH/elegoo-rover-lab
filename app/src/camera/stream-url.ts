// stream-url.ts — ライブ表示の MJPEG URL を選ぶ(純)。録画時はプロキシ経由(=上流1本・CORS解決)。
import type { RecordingConfig } from "../types";

export function cameraStreamUrl(cfg: RecordingConfig): string {
    return cfg.useProxy ? cfg.proxyStreamUrl : cfg.directStreamUrl;
}
