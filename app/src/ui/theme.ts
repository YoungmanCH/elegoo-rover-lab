// ui-theme.ts — 戦術マップの見た目の定数(色＋寸法)を1箇所に集約。
export const COLORS = {
    cyan: "#35e0ff",
    grid: "rgba(53,224,255,0.10)",
    hit: "#ffb454",                 // 壁ヒット点＝ゴールド(注目点)
    text: "#9fe9ff",
};
export const DIMS = {
    trailAlphaMin: 0.15,            // 最古の濃さ
    trailAlphaSpan: 0.85,           // 最古→現在 の増分
    coneTipRadius: 3,               // 壁ヒット点の半径[px]
    robotMarkerPx: 8,   // ★追加: robot 中心マーカーの高さ[px]
    font: "12px ui-monospace, Menlo, Consolas, monospace",
    textPad: 8,
};
