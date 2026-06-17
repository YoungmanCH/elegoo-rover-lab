// ui.ts — Canvas にシムの世界を描く。状態・ロジックは持たない(描画だけ)。
import type { World, SimConfig } from "./sim/model";

/** 部屋(cm)を Canvas(px) に収める拡大率。 */
function scaleFor(canvas: HTMLCanvasElement, sc: SimConfig): number {
    return Math.min(canvas.width / sc.roomW, canvas.height / sc.roomH);
}

/** cm座標 → Canvas px座標。y は反転(奥=上 を 画面の上方向 へ)。 */
function toPx(x: number, y: number, sc: SimConfig, scale: number) {
    return { px: x * scale, py: (sc.roomH - y) * scale };
}

const ROBOT_RADIUS_PX = 6;  // 画面上のロボット表示半径
const GREY_COLOR = "#888"
const GREEN_COLOR = "#2b8a3e"

/** 世界を1フレーム描く(部屋の枠 + ロボットの位置と向き)。 */
export function draw(ctx: CanvasRenderingContext2D, world: World, sc: SimConfig): void {
    const { canvas } = ctx;
    const scale = scaleFor(canvas, sc);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 部屋の枠
    ctx.strokeStyle = GREY_COLOR;
    ctx.strokeRect(0, 0, sc.roomW * scale, sc.roomH * scale);

    // ロボット本体(丸)
    const { x, y, yawDeg } = world.pose;
    const p = toPx(x, y, sc, scale);
    const r = ROBOT_RADIUS_PX;
    ctx.fillStyle = GREEN_COLOR;
    ctx.beginPath();
    ctx.arc(p.px, p.py, r, 0, Math.PI * 2);     // 半径6pxの円を描く
    ctx.fill();

    // 向きの矢印(yaw方向。画面yは下向きなので sin の符号を反転)
    const rad = (yawDeg * Math.PI) / 180;
    ctx.strokeStyle = GREEN_COLOR;
    ctx.beginPath();
    ctx.moveTo(p.px, p.py);

    // 矢印 = 半径の2.5倍(=15px)の長さ
    ctx.lineTo(p.px + Math.cos(rad) * r * 2.5, p.py - Math.sin(rad) * r * 2.5);
    ctx.stroke();
}
