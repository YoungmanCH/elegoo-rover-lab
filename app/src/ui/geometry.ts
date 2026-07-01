// ui-geometry.ts — 描画用の幾何(純)。角度・極座標だけ。

/** 実機のコーン方向用: 指令 aimDeg があれば追従、無ければ前回保持(sim advance と同規約)。
 *  実際に測っている(指令)方向を描く。 */
export function nextServoDeg(prevServoDeg: number, aimDeg: number | undefined): number {
    return aimDeg ?? prevServoDeg;
}

/** robot 中心表示のレイアウト: canvas から中心(cx,cy)と px/cm スケールを出す(純)。 */
export function sonarLayout(
    canvasW: number, 
    canvasH: number, 
    maxRangeCm: number, 
    padPx: number
): { cx: number; cy: number, scale: number } {
    const cx = canvasW / 2;
    const cy = canvasH / 2;
    const radius = Math.min(cx, cy) - padPx * 2;
    return { cx, cy, scale: radius / maxRangeCm };
}

/** relDeg(0=正面=上・+左=反時計) と距離[cm] を canvas px 点に(純)。 */
export function sonarPointPx(
    relDeg: number, 
    distanceCm: number, 
    cx: number, 
    cy: number, 
    scale: number
): { px: number, py: number } {
    const a = ((-90 - relDeg) * Math.PI) / 180;    // 0=上(正面), +relDeg(左)=反時計
    return { 
        px: cx + Math.cos(a) * distanceCm * scale, 
        py: cy + Math.sin(a) * distanceCm * scale 
    };
}

/** サンプルの古さ(nowT-t)を不透明度 [min, min+span] に写す(純)。新しいほど濃い・fadeMs で線形に薄れる。 */
export function fadeAlpha(
    nowT: number, 
    t: number, 
    fadeMs: number,
    min: number, 
    span: number
): number {
    const age = Math.min(1, Math.max(0, (nowT - t) / fadeMs));      // 0(新)〜1(古)にクランプ
    return min + span * (1 - age);
}
