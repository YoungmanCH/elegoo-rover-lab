// serialize.ts — Trajectory を NDJSON / CSV に整形(純)。pose は推定なので est_ 接頭で明示。列 COLUMNS が正本。
import type { Trajectory } from "./trajectory";
import type { TickSample } from "../types";
import { takeEstimate } from "../domain/estimated";

const COLUMNS = ["t", "dt", "cmdKind", "speed", "distanceCm", "lifted", "phase", "est_x", "est_y", "est_yaw", "estimated"] as const;

/** 1tick を「実測列＋est_接頭の推定列」の平坦オブジェクトに(pose は明示 unwrap)。 */
function flat(s: TickSample): Record<typeof COLUMNS[number], string | number | boolean> {
    const p = takeEstimate(s.pose);
    return { t: s.t, dt: s.dt, cmdKind: s.cmdKind, speed: s.speed, distanceCm: s.distanceCm, lifted: s.lifted, phase: s.phase, est_x: p.x, est_y: p.y, est_yaw: p.yawDeg, estimated: s.estimated };
}

export function toNDJSON(tr: Trajectory): string {
    const lines = [JSON.stringify({ type: "header", ...tr.header })];
    for (const s of tr.samples()) lines.push(JSON.stringify({ type: "tick", ...flat(s) }));
    return lines.join("\n") + "\n";
}
export function toCSV(tr: Trajectory): string {
    const rows = [COLUMNS.join(",")];
    for (const s of tr.samples()) { const f = flat(s); rows.push(COLUMNS.map((c) => String(f[c])).join(",")); }
    return rows.join("\n") + "\n";
}
