// protocol.ts — 境界の契約(シリアル)のWeb側実装。Command/センサ ⇔ 文字列の変換だけ(純粋)。
//
// 送信: Command → 駆動JSON / 各センサの問い合わせJSON
// 受信: 実機応答 "{<H>_<payload>}" を分解し値へ変換
// 形式は ELEGOO ファームで確認済み(出典: stage3-code.md §0)。
import type { Command } from "../types";

// N=3 の D1: 1=左 / 2=右 / 3=前進 / 4=後退 (CMD_CarControl)
const DRIVE_DIR = { forward: 3, rotateLeft: 1, rotateRight: 2 } as const;

/** Command → 送信JSON。H は文字列で送る(ファームが char* で読むため)。 */
export function encodeCommand(cmd: Command, h: string): string {
    if (cmd.kind === "stop") {
        // 確実な停止は N=4(左右モータ速度)の 0/0。N=3 速度0 は直進補正が残り得るため避ける。
        return JSON.stringify({ H: h, N: 4, D1: 0, D2: 0 });
    }
    return JSON.stringify({ H: h,N: 3, D1: DRIVE_DIR[cmd.kind], D2: cmd.speed });
}

/** 前方距離の問い合わせ(D1=2 で数値を返させる)。 */
export function encodeQueryDistance(h: string): string {
    return JSON.stringify({ H: h, N: 21, D1: 2 });
}

/** 離地の問い合わせ。 */
export function encodeQueryLifted(h: string): string {
    return JSON.stringify({ H: h, N: 23 });
}

/** ヨー角の問い合わせ(N=24 は自前追加)。 */
export function encodeQueryYaw(h: string): string {
    return JSON.stringify({ H: h, N: 24 });
}

export type Frame = { h: string, payload: string };

/** 応答フレーム "{<H>_<payload>}" を分解。形式外なら null。 */
export function parseFrame(s: string): Frame | null {
    const m = s.match(/^\{([^_}]+)_(.*)\}$/);
    return m ? { h: m[1], payload: m[2] } : null;
}

/** 距離[cm]。 */
export function decodeDistance(payload: string): number {
    return parseInt(payload, 10);
}

/** ヨー角[度]。 */
export function decodeYaw(payload: string): number {
    return parseFloat(payload);
}

/**
 * 離地(lifted)。★実機は反転:
 *   接地(床にいる)  → "true"   → lifted=false
 *   離地(持ち上げ)  → "false"  → lifted=true
 * なので payload==="false" のとき lifted=true。
 */
export function decodeLifted(payload: string): boolean {
    return payload === "false";
}
