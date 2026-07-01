// status.ts — 接続状態→ヘッダ表示(ラベル/トーン)を作る(純)。DOM/canvas は知らない＝単体テスト可。
// tone: sim=未接続(架空・非live) / live=USB or WiFi 接続。色分けは CSS(data-tone)で。
import type { TrajectoryHeader } from "../types";

export type LinkTone = "sim" | "live";

/** 接続種別→ヘッダの {ラベル, トーン}。sim=架空(未接続)、usb/wifi=live(接続)。 */
export function linkStatusView(source: TrajectoryHeader["source"]): { label: string; tone: LinkTone } {
    switch (source) {
        case "usb":  return { label: "LINK · USB",   tone: "live" };
        case "wifi": return { label: "LINK · WiFi",  tone: "live" };
        case "sim":  return { label: "SIM · 架空環境", tone: "sim" };
    }
}

