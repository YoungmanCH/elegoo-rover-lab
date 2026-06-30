// sample.ts — 観測値を1tickの記録(TickSample)に組むだけ(純)。pose は precision 桁に丸める。
import type { TickObservation, TickSample } from "../types";

function _round(v: number, p: number): number {
    const k = 10 ** p;
    return Math.round(v * k) / k;
}

export function makeSample(o: TickObservation, precision: number): TickSample {
    return {
        t: o.t,
        dt: o.dt,
        cmdKind: o.cmd.kind,
        speed: o.cmd.speed,
        distanceCm: o.sensors.distanceCm,
        lifted: o.sensors.lifted,
        phase: o.phase,
        pose: { 
            x: _round(o.pose.x, precision), 
            y: _round(o.pose.y, precision), 
            yawDeg: _round(o.pose.yawDeg, precision),
        },
        estimated: o.estimated,
    };
}
