// ui/draw.ts — Canvas に sim の戦術マップを描く(描画だけ・状態は持たない)。図形は全て実データに対応。
// SRP: draw は各レイヤを順に呼ぶオーケストレータ。寸法/色=ui/theme、幾何/整形=ui/geometry・ui/readout(純・テスト済)。
import type { World, SimConfig } from "../sim/model";
import type { Pose } from "../types";
import { aimAngleDeg, polarPointCm, scaleFor, toPx } from "./geometry";
import { formatReadout } from "./readout";
import { COLORS as C, DIMS as D } from "./theme";

/** cm→px 投影(クロージャ。pure な toPx から作る)。 */
type Projector = (x: number, y: number) => { px: number, py: number };

/** 1フレーム描画。trail=過去pose列, distanceCm=前方センサ実測[cm](省略/0=コーン非表示)。全図形が実データに対応。 */
export function draw(
    ctx: CanvasRenderingContext2D, 
    world: World, 
    sc: SimConfig,
    trail?: Pose[], 
    distanceCm?: number
): void {
    const { canvas } = ctx;
    const scale = scaleFor(canvas.width, canvas.height, sc);
    const P: Projector = (x, y) => toPx(x, y, sc, scale);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawGrid(ctx, P, sc);
    drawFrame(ctx, sc, scale);
    if (trail) drawTrail(ctx, P, trail);
    if (distanceCm && distanceCm > 0) drawSensorCone(ctx, P, world, sc, distanceCm);
    drawRobot(ctx, P, world.pose);
    drawReadout(ctx, world, sc, distanceCm);
}

/** スケール格子(GRID ごと＝距離の基準)。 */
function drawGrid(ctx: CanvasRenderingContext2D, P: Projector, sc: SimConfig): void {
    ctx.lineWidth = 1; ctx.strokeStyle = C.grid; ctx.beginPath();
    for (let x = 0; x <= sc.roomW; x += D.gridCm) { const a = P(x, 0), b = P(x, sc.roomH); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); }
    for (let y = 0; y <= sc.roomH; y += D.gridCm) { const a = P(0, y), b = P(sc.roomW, y); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); }
    ctx.stroke();
}

/** 部屋の枠(発光・小さめ)。 */
function drawFrame(ctx: CanvasRenderingContext2D, sc: SimConfig, scale: number): void {
    ctx.strokeStyle = C.frame; ctx.lineWidth = D.frameWidth;
    ctx.shadowColor = C.cyan; ctx.shadowBlur = D.frameGlow;
    ctx.strokeRect(D.frameInset, D.frameInset, sc.roomW * scale - D.frameInset * 2, sc.roomH * scale - D.frameInset * 2);
    ctx.shadowBlur = 0;
}

/** トレイル(実際の経路・古いほど淡く＝情報は歪めない)。 */
function drawTrail(ctx: CanvasRenderingContext2D, P: Projector, trail: Pose[]): void {
    if (trail.length < 2) return;
    ctx.strokeStyle = C.trail; ctx.lineWidth = D.trailWidth;
    for (let i = 1; i < trail.length; i++) {
        const a = P(trail[i - 1].x, trail[i - 1].y), b = P(trail[i].x, trail[i].y);
        ctx.globalAlpha = D.trailAlphaMin + D.trailAlphaSpan * (i / (trail.length - 1));   // 現在に近いほど濃い
        ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

/** スキャンコーン＝センサ実測(中心線=測った方向, 終端=測った距離)。 */
function drawSensorCone(ctx: CanvasRenderingContext2D, P: Projector, world: World, sc: SimConfig, distanceCm: number): void {
    const { x, y, yawDeg } = world.pose;
    const here = P(x, y);
    const aim = aimAngleDeg(yawDeg, world.servoDeg, sc.servoForwardDeg);
    const tip = polarPointCm(x, y, aim, distanceCm);                  // 実測の壁ヒット点
    const eL = polarPointCm(x, y, aim + D.coneHalfDeg, distanceCm);
    const eR = polarPointCm(x, y, aim - D.coneHalfDeg, distanceCm);
    const pTip = P(tip.x, tip.y), pL = P(eL.x, eL.y), pR = P(eR.x, eR.y);
    ctx.fillStyle = C.cone;
    ctx.beginPath(); ctx.moveTo(here.px, here.py); ctx.lineTo(pL.px, pL.py); ctx.lineTo(pR.px, pR.py); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.coneLine; ctx.lineWidth = 1;                 // 中心ビーム＝実測方向・実測長
    ctx.beginPath(); ctx.moveTo(here.px, here.py); ctx.lineTo(pTip.px, pTip.py); ctx.stroke();
    ctx.fillStyle = C.hit; ctx.shadowColor = C.hit; ctx.shadowBlur = D.coneGlow;   // 壁ヒット点(ゴールド)
    ctx.beginPath(); ctx.arc(pTip.px, pTip.py, D.coneTipRadius, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
}

/** 機体マーカー(向き＝シェブロン / 位置＝中心ドットで断定)。寸法は cm でマップにスケール。 */
function drawRobot(ctx: CanvasRenderingContext2D, P: Projector, pose: Pose): void {
    const { x, y, yawDeg } = pose;
    const here = P(x, y);
    const nose = polarPointCm(x, y, yawDeg, D.robotNoseCm);
    const wl = polarPointCm(x, y, yawDeg + D.robotWingDeg, D.robotWingCm);
    const wr = polarPointCm(x, y, yawDeg - D.robotWingDeg, D.robotWingCm);
    const pN = P(nose.x, nose.y), pWL = P(wl.x, wl.y), pWR = P(wr.x, wr.y);
    ctx.fillStyle = C.cyan; ctx.shadowColor = C.cyan; ctx.shadowBlur = D.robotGlow;
    ctx.beginPath(); ctx.moveTo(pN.px, pN.py); ctx.lineTo(pWL.px, pWL.py); ctx.lineTo(pWR.px, pWR.py); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = C.core;                                          // 正確な現在地＝中心の白点
    ctx.beginPath(); ctx.arc(here.px, here.py, D.coreDotRadius, 0, Math.PI * 2); ctx.fill();
}

/** 数値リードアウト(文字列は ui/readout・純)。 */
function drawReadout(ctx: CanvasRenderingContext2D, world: World, sc: SimConfig, distanceCm?: number): void {
    ctx.font = D.font; ctx.textBaseline = "top";
    ctx.fillStyle = C.text;
    ctx.fillText(formatReadout(world.pose, world.servoDeg, sc.servoForwardDeg, distanceCm), D.textPad, D.textPad);
    ctx.fillStyle = C.textDim;
    ctx.fillText(`GRID ${D.gridCm}cm`, D.textPad, ctx.canvas.height - D.gridLabelBottom);
}
