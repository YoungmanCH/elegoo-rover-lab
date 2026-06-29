// scan-decision.ts — 左右の測定から「どちらへ曲がるか」を決める純粋ルールだけ。
import type { TurnDir } from "../types";

/** 逃げ方: 左/右へ曲がる、または後退(+180)。 */
export type Escape = TurnDir | "reverse";

/** chooseEscape が必要とする調整値だけ(Config の部分集合)。Config をそのまま渡せる。 */
export type EscapeParams = {
    /** これ以上(or 0=エコー無し)で「空き」と見なす距離[cm]。 */
    openCm: number;

    /** 左右が同じ広さのときに倒す既定方向。 */
    turnDir: TurnDir; 
}

/** エコー無し(0)=遠い、または openCm 以上なら「空き」。 */
export function isOpen(distanceCm: number, openCm: number): boolean {
    return distanceCm === 0 || distanceCm >= openCm;
}

/** 比較用クリアランス。0(エコー無し)は最遠＝Infinity。 */
export function clearance(distanceCm: number): number {
    return distanceCm === 0 ? Infinity : distanceCm;
}

/**
 * 左右の距離から逃げ方を決める。
 *   両側とも壁 → "reverse"(どちらにも曲がれない＝後退して180度)
 *   片側だけ空き → その側へ
 *   両側空き     → 壁が遠い(広い)方へ。完全同値のときだけ p.turnDir
 */
export function chooseEscape(leftCm: number, rightCm: number, p: EscapeParams): Escape {
    const l = isOpen(leftCm, p.openCm);
    const r = isOpen(rightCm, p.openCm);
    if (!l && !r) return "reverse";
    if (l && !r) return "left";
    if (r && !l) return "right";
    const cl = clearance(leftCm);
    const cr = clearance(rightCm);
    if (cl === cr) return p.turnDir;
    return cl > cr ? "left" : "right";
}
