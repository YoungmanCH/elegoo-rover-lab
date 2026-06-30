// serialize.ts — Trajectory を NDJSON / CSV に整形(純)。CSV の列は COLUMNS が唯一の正本。
import type { Trajectory } from "./trajectory";
import type { TickSample } from "../types";

const COLUMNS = [
    "t",
    "dt",
    "cmdKind",
    "speed",
    "distanceCm",
    "lifted",
    "phase",
    "x",
    "y",
    "yawDeg",
    "estimated"
] as const;

export function toNDJSON(tr: Trajectory): string {
    const lines = [JSON.stringify({ type: "header", ...tr.header })];
    for (const s of tr.samples()) lines.push(JSON.stringify({ type: "tick", ...s }));
    return lines.join("\n") + "\n";
}

function _cell(s: TickSample, col: typeof COLUMNS[number]): string | number | boolean {
    switch(col) {
        case "x": return s.pose.x;
        case "y": return s.pose.y;
        case "yawDeg": return s.pose.yawDeg;
        default: return s[col];                 // 残りは TickSample のキー(t/dt/cmdKind/...)
    }
}

export function toCSV(tr: Trajectory): string {
    const rows = [COLUMNS.join(",")];
    for (const s of tr.samples()) rows.push(COLUMNS.map((c) => String(_cell(s, c))).join(","));
    return rows.join("\n") + "\n";
}
