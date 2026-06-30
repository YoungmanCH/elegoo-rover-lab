// recorder-client.ts — 録画開始/停止を proxy へ通知する(副作用=fetch)。URL組立は control-url(純)に分離。
import { recControlUrl } from "./control-url";

export async function recStart(controlUrl: string, sessionId: string): Promise<void> {
    await fetch(recControlUrl(controlUrl, "start", sessionId), { method: "POST" });
}

export async function recStop(controlUrl: string): Promise<void> {
    await fetch(recControlUrl(controlUrl, "stop", ""), { method: "POST" });
}
