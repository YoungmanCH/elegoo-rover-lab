// ui/sonar-view.ts — 実測のみの robot-centric 表示(描画だけ)。位置/軌跡は描かない。
import type { SonarSample, Sensors, Command } from "../types";
import { sonarLayout, sonarPointPx } from "./geometry";
import { formatSensorReadout } from "./readout";
import { COLORS as C, DIMS as D } from "./theme";

type Center = { cx: number; cy: number; scale: number; };
type Cfg = { maxRangeCm: number; rangeRingCm: number; fadeMs: number };

/** 1フレーム描画。中心/スケールは純関数、各レイヤは単一責務。 */
export function drawSonar(
    ctx: CanvasRenderingContext2D,
    samples: SonarSample[],
    sensors: Sensors,
    cmd: Command,
    servoDeg: number,
    servoForwardDeg: number,
    cfg: Cfg
): void {
    const { canvas } = ctx;
    const c = sonarLayout(canvas.width, canvas.height, cfg.maxRangeCm, D.textPad);      // 幾何=純関数
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawRangeRings(ctx, c, cfg);
    drawRays(ctx, samples, c, cfg);
    drawRobotCenter(ctx, c);
    drawSonarReadout(ctx, sensors, cmd, servoDeg, servoForwardDeg);
}

/** 距離リング(実スケール・何cm先か)。 */
function drawRangeRings(ctx: CanvasRenderingContext2D, c: Center, cfg: Cfg): void {
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let r = cfg.rangeRingCm; r <= cfg.maxRangeCm; r += cfg.rangeRingCm) {
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, r * c.scale, 0, Math.PI * 2);
        ctx.stroke();
    }
}

/** 実測 ray + ヒット点(古いほど淡く)。座標は sonarPointPx(純)に委譲。 */
function drawRays(
    ctx: CanvasRenderingContext2D, 
    samples: SonarSample[], 
    c: Center, 
    cfg: Cfg
): void {
    const now = samples.length ? samples[samples.length - 1].t : 0;
    for (const s of samples) {
        const p = sonarPointPx(s.relDeg, s.distanceCm, c.cx, c.cy, c.scale);
        ctx.globalAlpha = D.trailAlphaMin + D.trailAlphaSpan * (1 - Math.min(1, (now - s.t) / cfg.fadeMs));
        ctx.beginPath();
        ctx.moveTo(c.cx, c.cy);
        ctx.lineTo(p.px, p.py);
        ctx.stroke();
        ctx.fillStyle = C.hit;
        ctx.beginPath();
        ctx.arc(p.px, p.py, D.coneTipRadius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

/** ロボット(中心・正面=上のシェブロン)。位置/向きは描かない=常に中心・上。 */
function drawRobotCenter(ctx: CanvasRenderingContext2D, c: Center): void {
    ctx.fillStyle = C.cyan;
    ctx.beginPath();
    ctx.moveTo(c.cx, c.cy - D.robotMarkerPx);
    ctx.lineTo(c.cx - D.robotMarkerPx * 0.6, c.cy + D.robotMarkerPx * 0.6);
    ctx.lineTo(c.cx + D.robotMarkerPx * 0.6, c.cy + D.robotMarkerPx * 0.6);
    ctx.closePath();
    ctx.fill();
}

/** 実測リードアウト(X/Y 無し・文字列は ui/readout・純)。 */
function drawSonarReadout(
    ctx: CanvasRenderingContext2D, 
    sensors: Sensors, 
    cmd: Command, 
    servoDeg: number, 
    servoForwardDeg: number
): void {
    ctx.font = D.font;
    ctx.textBaseline = "top";
    ctx.fillStyle = C.text;
    ctx.fillText(
        formatSensorReadout(
            sensors.distanceCm, 
            servoDeg, 
            servoForwardDeg, 
            sensors.lifted, 
            cmd.kind
        ), 
        D.textPad,
        D.textPad
    );
}
