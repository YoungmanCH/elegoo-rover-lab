// trajectory.ts — ヘッダ + サンプル列の集約。蓄積のみ(整形は serialize へ分離=SRP)。
import type { TrajectoryHeader, TickSample } from "../types";

export type Trajectory = {
    header: TrajectoryHeader;
    append(s: TickSample): void;
    samples(): TickSample[];        // 内部配列のコピーを返す(外から壊させない)
    size(): number;
}

export function createTrajectory(header: TrajectoryHeader): Trajectory {
    const items: TickSample[] = [];
    return {
        header,
        append: (s) => { items.push(s); },
        samples: () => [...items],
        size: () => items.length,
    };
}
