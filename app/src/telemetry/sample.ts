// sample.ts — 観測値を1tickの記録(TickSample)に組むだけ(純)。pose は「推定」として precision 桁に丸める。
import type { TickObservation, TickSample } from "../types";
import { estimated, takeEstimate } from "../domain/estimated";

function _round(v: number, p: number): number { const k = 10 ** p; return Math.round(v * k) / k; }

export function makeSample(o: TickObservation, precision: number): TickSample {
    const p = takeEstimate(o.pose);   // 推定と承知で取り出す(明示)
    return {
        t: o.t, dt: o.dt, cmdKind: o.cmd.kind, speed: o.cmd.speed,
        distanceCm: o.sensors.distanceCm, lifted: o.sensors.lifted, phase: o.phase,
        pose: estimated({ x: _round(p.x, precision), y: _round(p.y, precision), yawDeg: _round(p.yawDeg, precision) }),
        estimated: o.estimated,
    };
}
