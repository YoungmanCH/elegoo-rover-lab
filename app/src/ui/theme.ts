// ui-theme.ts — 戦術マップの見た目の定数(色＋寸法)を1箇所に集約。
export const COLORS = {
    cyan: "#35e0ff",
    grid: "rgba(53,224,255,0.10)",
    frame: "rgba(53,224,255,0.5)",
    trail: "rgba(53,224,255,0.55)",
    cone: "rgba(53,224,255,0.10)",
    coneLine: "rgba(53,224,255,0.35)",
    hit: "#ffb454",                 // 壁ヒット点＝ゴールド(注目点)
    text: "#9fe9ff",
    textDim: "rgba(159,233,255,0.5)",
    core: "#eafaff",
};
export const DIMS = {
    gridCm: 50,                     // スケール格子の間隔[cm](距離の基準)
    frameInset: 0.75,               // 枠の内側オフセット[px]
    frameWidth: 1.5,
    frameGlow: 8,
    trailWidth: 2,
    trailAlphaMin: 0.15,            // 最古の濃さ
    trailAlphaSpan: 0.85,           // 最古→現在 の増分
    coneHalfDeg: 7,                 // コーン横幅＝公称FOVの図示(±度)
    coneTipRadius: 3,               // 壁ヒット点の半径[px]
    coneGlow: 8,
    robotNoseCm: 10,                // シェブロン先端[cm]
    robotWingDeg: 150,              // 翼角(yaw から±)[度]
    robotWingCm: 7,                 // 翼長[cm]
    robotGlow: 10,
    coreDotRadius: 2,               // 現在地ドット[px]
    font: "12px ui-monospace, Menlo, Consolas, monospace",
    textPad: 8,
    gridLabelBottom: 18,            // GRID ラベルの下余白[px]
};
