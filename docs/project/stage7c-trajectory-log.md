# 段階7c：軌跡ログのデータ構造と整形 — TDD

> **ゴール**：走行を「**ヘッダ＋tickサンプル列**」として記録し、**NDJSON / CSV** に出す中核を TDD で作る。本書は**純粋なデータ構造と整形だけ**に集中（位置の出どころ＝真値/推定の差し替えと配線は [7d](stage7d-recorder-and-ui.md)）。
> **SRP**：「サンプル化」「蓄積」「整形」を別ファイルに分ける（混ぜると純度とテスト容易性が落ちる）。
> **前提**：[7a](stage7a-pose-and-kinematics.md)（`Pose`）／[7b](stage7b-pose-estimation.md)（`MotionModel`）。
> **このstageの位置**：[7a](stage7a-pose-and-kinematics.md) → [7b](stage7b-pose-estimation.md) → 7c(本書) → [7d](stage7d-recorder-and-ui.md)。
> **編集はあなた**。括弧は半角。

---

## 0. この回の増分

| # | 増分 | ファイル | テスト |
|---|---|---|---|
| 1 | 型追加（`TickObservation` / `TickSample` / `TrajectoryHeader`） | `types.ts` | — |
| 2 | `session-meta`（`newSessionId` / `makeHeader`） | `telemetry/session-meta.ts` | **先に** |
| 3 | `sample`（`makeSample`） | `telemetry/sample.ts` | **先に** |
| 4 | `trajectory`（`createTrajectory`） | `telemetry/trajectory.ts` | **先に** |
| 5 | `serialize`（`toNDJSON` / `toCSV`） | `telemetry/serialize.ts` | **先に**（往復・列ズレ検証） |

---

## 1. 増分1：型追加（`types.ts`）

```ts
/** 1tick分の生の観測（makeSample の入力）。recorder が毎tick組み立てる。cmd/sensors はネストのまま。 */
export type TickObservation = {
    t: number; dt: number; cmd: Command; sensors: Sensors; phase: State["phase"]; pose: Pose; estimated: boolean;
};

/** 1tick分の記録（軌跡ログの最小単位＝makeSample の出力）。TickObservation を平坦化＋丸めした形。 */
export type TickSample = {
    t: number;            // セッション基準 t0 からの相対[ms]（動画と同じ時間軸）
    dt: number;           // 直前tickからの実経過[ms]（推定に使った値）
    cmdKind: Command["kind"];
    speed: number;
    distanceCm: number;
    lifted: boolean;
    phase: State["phase"];
    pose: Pose;           // sim=真値 / 実機=推定
    estimated: boolean;   // true=推定(実機) / false=真値(sim)
};

/** 軌跡ログのヘッダ（自己記述的：再現に要る文脈を入れる）。 */
export type TrajectoryHeader = {
    v: number;
    sessionId: string;
    startedAtIso: string;
    source: "sim" | "usb" | "wifi";
    config: Config;
    motionModel: MotionModel;
    pose0: Pose;
    videoFile: string | null;   // カメラ録画(stage8)と紐付け。無ければ null
};
```

---

## 2. 増分2：`session-meta`

### ① テスト（RED）
`app/src/telemetry/session-meta.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { newSessionId, makeHeader } from "./session-meta";   // ← RED
import type { Config, MotionModel } from "../types";

const cfg = { wallCm: 20 } as unknown as Config;             // 本テストでは中身を問わない(素通し)
const mm: MotionModel = { forwardCmPerSec: 20, reverseCmPerSec: 20, turnDegPerSec: 90, refDriveSpeed: 80, refTurnSpeed: 100 };

describe("newSessionId", () => {
    it("ISO の : と . を - に置換しファイル名安全にする", () => {
        expect(newSessionId("2026-06-28T12:00:00.000Z")).toBe("2026-06-28T12-00-00-000Z");
    });
});

describe("makeHeader", () => {
    it("引数を詰め v=1・videoFile 既定 null のヘッダを作る", () => {
        const h = makeHeader({
            sessionId: "s1", startedAtIso: "2026-06-28T12:00:00.000Z", source: "wifi",
            config: cfg, motionModel: mm, pose0: { x: 20, y: 75, yawDeg: 0 },
        });
        expect(h.v).toBe(1);
        expect(h.videoFile).toBeNull();
        expect(h.sessionId).toBe("s1");
        expect(h.config).toBe(cfg);     // 素通し(スナップショット)
        expect(h.source).toBe("wifi");  // source も素通し。makeHeader は source で分岐しない＝1値で十分
    });
    it("videoFile を渡せばそのまま保持する(動画連携の契約)", () => {
        const h = makeHeader({
            sessionId: "s1", startedAtIso: "2026-06-28T12:00:00.000Z", source: "wifi",
            config: cfg, motionModel: mm, pose0: { x: 20, y: 75, yawDeg: 0 },
            videoFile: "rec.mp4",
        });
        expect(h.videoFile).toBe("rec.mp4");   // a.videoFile ?? null の「指定時」分岐(既定 null の対)
    });
});
```

### ② GREEN
`app/src/telemetry/session-meta.ts`
```ts
// session-meta.ts — sessionId とヘッダの生成(純)。時刻は外から注入(内部で new Date しない=テスト容易)。
import type { TrajectoryHeader, Config, MotionModel, Pose } from "../types";

export function newSessionId(nowIso: string): string {
    return nowIso.replace(/[:.]/g, "-");
}

export function makeHeader(a: {
    sessionId: string; startedAtIso: string; source: TrajectoryHeader["source"];
    config: Config; motionModel: MotionModel; pose0: Pose; videoFile?: string | null;
}): TrajectoryHeader {
    return { v: 1, ...a, videoFile: a.videoFile ?? null };   // videoFile はスプレッド後に上書き(既定 null)
}
```

---

## 3. 増分3：`sample`

### ① テスト（RED）
`app/src/telemetry/sample.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { makeSample } from "./sample";          // ← RED
import type { Command, Sensors, State, Pose } from "../types";

const base = {
    t: 120, dt: 120,
    cmd: { kind: "forward", speed: 80 } as Command,
    sensors: { distanceCm: 48, yawDeg: 0, lifted: false } as Sensors,
    phase: "drive" as State["phase"],
    pose: { x: 1.2345, y: 2.7, yawDeg: 90.04 } as Pose,
    estimated: true,
};

describe("makeSample", () => {
    it("観測値を TickSample のフィールドに対応づける", () => {
        expect(makeSample(base, 1)).toMatchObject({
            t: 120, dt: 120, cmdKind: "forward", speed: 80,
            distanceCm: 48, lifted: false, phase: "drive", estimated: true,
        });
    });
    it("pose を precision 桁に丸める(桁は config 由来=ハードコーディングしない)", () => {
        expect(makeSample(base, 1).pose).toEqual({ x: 1.2, y: 2.7, yawDeg: 90 });
    });
    it("純粋: 入力を壊さない", () => {
        const snap = JSON.parse(JSON.stringify(base));
        makeSample(base, 1);
        expect(base).toEqual(snap);
    });
});
```

### ② GREEN
`app/src/telemetry/sample.ts`
```ts
// sample.ts — 観測(TickObservation)を1tickの記録(TickSample)に組むだけ(純)。pose は precision 桁に丸める。
import type { TickSample, TickObservation } from "../types";   // 型は types.ts に集約

function round(v: number, p: number): number {
    const k = 10 ** p;
    return Math.round(v * k) / k;
}

export function makeSample(o: TickObservation, precision: number): TickSample {
    return {
        t: o.t, dt: o.dt,
        cmdKind: o.cmd.kind, speed: o.cmd.speed,
        distanceCm: o.sensors.distanceCm, lifted: o.sensors.lifted,
        phase: o.phase,
        pose: { x: round(o.pose.x, precision), y: round(o.pose.y, precision), yawDeg: round(o.pose.yawDeg, precision) },
        estimated: o.estimated,
    };
}
```

---

## 4. 増分4：`trajectory`（蓄積の集約）

### ① テスト（RED）
`app/src/telemetry/trajectory.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { createTrajectory } from "./trajectory";       // ← RED
import type { TrajectoryHeader, TickSample } from "../types";

const header = { v: 1, sessionId: "s1" } as unknown as TrajectoryHeader;
const sample = (t: number): TickSample => ({
    t, dt: 120, cmdKind: "forward", speed: 80, distanceCm: 50,
    lifted: false, phase: "drive", pose: { x: t, y: 0, yawDeg: 0 }, estimated: true,
});

describe("createTrajectory", () => {
    it("空で始まる", () => {
        expect(createTrajectory(header).size()).toBe(0);
    });
    it("append は順序を保ち size が増える", () => {
        const tr = createTrajectory(header);
        tr.append(sample(0)); tr.append(sample(120));
        expect(tr.size()).toBe(2);
        expect(tr.samples().map((s) => s.t)).toEqual([0, 120]);
    });
    it("ヘッダを保持する", () => {
        expect(createTrajectory(header).header).toBe(header);
    });
    it("samples() のコピーを外から壊しても内部は不変", () => {
        const tr = createTrajectory(header);
        tr.append(sample(0));
        tr.samples().push(sample(999));     // 返り値を破壊してみる
        expect(tr.size()).toBe(1);          // 内部は守られる
    });
});
```

### ② GREEN
`app/src/telemetry/trajectory.ts`
```ts
// trajectory.ts — ヘッダ + サンプル列の集約。蓄積のみ(整形は serialize へ分離=SRP)。
import type { TrajectoryHeader, TickSample } from "../types";

export type Trajectory = {
    header: TrajectoryHeader;
    append(s: TickSample): void;
    samples(): TickSample[];     // 内部配列のコピーを返す(外から壊させない)
    size(): number;
};

export function createTrajectory(header: TrajectoryHeader): Trajectory {
    const items: TickSample[] = [];
    return {
        header,
        append: (s) => { items.push(s); },
        samples: () => [...items],
        size: () => items.length,
    };
}
```

---

## 5. 増分5：`serialize`（NDJSON / CSV）

### ① テスト（RED）
`app/src/telemetry/serialize.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { toNDJSON, toCSV } from "./serialize";          // ← RED
import { createTrajectory } from "./trajectory";
import type { TrajectoryHeader, TickSample } from "../types";

const header = { v: 1, sessionId: "s1" } as unknown as TrajectoryHeader;
const sample = (t: number): TickSample => ({
    t, dt: 120, cmdKind: "forward", speed: 80, distanceCm: 50,
    lifted: false, phase: "drive", pose: { x: t, y: 0, yawDeg: 0 }, estimated: true,
});
function withSamples(n: number) {
    const tr = createTrajectory(header);
    for (let i = 0; i < n; i++) tr.append(sample(i * 120));
    return tr;
}

describe("toNDJSON", () => {
    it("1行目=header, 以降=tick, 行数 = 1 + 件数", () => {
        const lines = toNDJSON(withSamples(2)).trim().split("\n");
        expect(lines.length).toBe(3);
        expect(JSON.parse(lines[0]).type).toBe("header");
        expect(JSON.parse(lines[1]).type).toBe("tick");
    });
    it("往復(round-trip): tick 行を parse すると元サンプルに戻る", () => {
        const tr = withSamples(1);
        const back = JSON.parse(toNDJSON(tr).trim().split("\n")[1]);
        expect(back).toMatchObject({ type: "tick", ...tr.samples()[0] });   // 取りこぼし無し
    });
    it("空 Trajectory → ヘッダ1行だけ", () => {
        expect(toNDJSON(createTrajectory(header)).trim().split("\n").length).toBe(1);
    });
});

describe("toCSV", () => {
    it("ヘッダ行が列定義と一致", () => {
        expect(toCSV(withSamples(1)).trim().split("\n")[0])
            .toBe("t,dt,cmdKind,speed,distanceCm,lifted,phase,x,y,yawDeg,estimated");
    });
    it("各行のセル数 = ヘッダ列数(列ズレ防止の不変条件)", () => {
        const rows = toCSV(withSamples(3)).trim().split("\n");
        const n = rows[0].split(",").length;
        for (const r of rows) expect(r.split(",").length).toBe(n);
    });
    it("空 Trajectory → ヘッダ行のみ", () => {
        expect(toCSV(createTrajectory(header)).trim().split("\n").length).toBe(1);
    });
});
```

### ② GREEN
`app/src/telemetry/serialize.ts`
```ts
// serialize.ts — Trajectory を NDJSON / CSV に整形(純)。CSV の列は COLUMNS が唯一の正本。
import type { Trajectory } from "./trajectory";
import type { TickSample } from "../types";

const COLUMNS = ["t","dt","cmdKind","speed","distanceCm","lifted","phase","x","y","yawDeg","estimated"] as const;

export function toNDJSON(tr: Trajectory): string {
    const lines = [JSON.stringify({ type: "header", ...tr.header })];
    for (const s of tr.samples()) lines.push(JSON.stringify({ type: "tick", ...s }));
    return lines.join("\n") + "\n";
}

function cell(s: TickSample, col: typeof COLUMNS[number]): string | number | boolean {
    switch (col) {
        case "x": return s.pose.x;
        case "y": return s.pose.y;
        case "yawDeg": return s.pose.yawDeg;
        default: return s[col];          // 残りは TickSample のキー(t/dt/cmdKind/...)
    }
}

export function toCSV(tr: Trajectory): string {
    const rows = [COLUMNS.join(",")];
    for (const s of tr.samples()) rows.push(COLUMNS.map((c) => String(cell(s, c))).join(","));
    return rows.join("\n") + "\n";
}
```
> **列ズレを構造的に防ぐ**：ヘッダ行も各行も `COLUMNS` から生成。フィールドを足すときは `COLUMNS` と `TickSample` を両方直す必要があり、C2（セル数一致）テストが片手落ちを検出する。

---

## 6. テストは足りるか（十分性チェック）

| モジュール | 担保するテスト | 不足と対処 |
|---|---|---|
| session-meta | 置換／v=1・videoFile 既定 null・config 素通し | 時刻生成は注入なので決定論的（`new Date` を持たない） |
| sample | 全フィールド対応／丸め（config由来）／純粋 | `precision=0`/負は境界として将来追加可（既定1で運用） |
| trajectory | 空／順序／件数／ヘッダ保持／**スナップショット性** | 大量件数の性能は機能外（[7d](stage7d-recorder-and-ui.md) 結合＋実測） |
| serialize | NDJSON 構造／**往復同一**／空／CSV ヘッダ／**列セル一致**／空 | フィールドが将来「カンマを含む文字列」になればエスケープ追加（テストも）。現状は数値/enum/真偽でカンマ無し＝不要 |

**結論**：軌跡ログの純ロジックは、分岐・境界・**往復同一（取りこぼし無し）**・**列ズレ不変条件**・純粋性まで押さえており十分。全純モジュール行カバレッジ 100% を狙える。

---
関連：[stage7b](stage7b-pose-estimation.md)（推定）／ [stage7d](stage7d-recorder-and-ui.md)（次：結線・保存・描画）／ [design-trajectory-recording-architecture.md](../reference/design-trajectory-recording-architecture.md)（全体・テスト戦略）
</content>
