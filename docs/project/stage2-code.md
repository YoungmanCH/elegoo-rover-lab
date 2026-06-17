# 段階2 コード草案（第一弾：`io/robot.ts` 契約 ＋ `sim/model.ts` 物理モデル）

> **段階2のゴール**：実機なしで、ブラウザ上の2Dシミュレータの中で掃除ロジック（段階1の `step`）が動くこと。
> **位置づけ**：レビュー用草案 → OKで実ファイルに落とす。段階2は量があるので2弾に分割。
> - **第一弾（この資料）**：`io/robot.ts`（IO契約）＋ `sim/model.ts`（純粋な物理モデル）＋ `sim/model.test.ts`。**全てハード非依存・DOM非依存でテスト可能**。
> - 第二弾：`sim/sim-robot.ts`（RobotIO実装）＋ `runner.ts`（制御ループ）＋ `ui.ts` / `index.html`（描画）。副作用側＝手動/スモーク。
> 参照：[code-design.md](code-design.md) ／ [cleaning-logic-spec.md](cleaning-logic-spec.md) ／ [stage1-code.md](stage1-code.md)

---

## 設計判断（先に固める）

| 論点 | 決定 | なぜ |
|---|---|---|
| 座標系 | 部屋は矩形 `[0, roomW] × [0, roomH]`、単位は **cm** | `distanceCm` / `wallCm` と単位を統一＝変換不要で取り違え防止 |
| 向き | `yawDeg`：0°=+x方向、**反時計回り(左)が +** | 段階1の左旋回＝yaw増加と整合（`rotateLeft`→+, `rotateRight`→−） |
| 壁 | 軸並行の矩形のみ（家具なし） | レイキャストが「箱の出口」で済む＝最小実装。家具は後で足せる |
| 速度→運動 | `cm/tick = (cmd.speed/255) × maxDriveCmPerTick`、回転も同様 | speed は無単位PWM。シム側で「255でどれだけ動くか」だけ決めれば物理になる |
| シム専用の値 | `config.ts` ではなく **`sim/model.ts` の `SimConfig`** に置く | `config.ts` は“ロボットの頭脳”の値。部屋サイズ等の“仮想世界”の値は責務が別 |
| ヨー折り返し | シムは **折り返さない連続値**を返す | 段階1の⚠（wrap）を踏まないので、ロジック検証を先に進められる |

---

## 1. `app/src/io/robot.ts` — IOの契約（最小）

実機とシムが「同じ顔」で振る舞うための境界。`runner` はこの `RobotIO` だけに依存する（依存逆転）。
**`Promise` にする理由**：実機の Web Serial は非同期。シムは即解決でよいが、型を揃えておけば runner を実機/シムで共通化できる。

```ts
// robot.ts — ロボット入出力の契約(read/send だけ)。実機・シムが各々これを実装する。
import type { Sensors, Command } from "../types";

export interface RobotIO {
  /** 現在のセンサ値を1ティック分読む。 */
  read(): Promise<Sensors>;

  /** 駆動指令を送る。 */
  send(cmd: Command): Promise<void>;
}
```

---

## 2. `app/src/sim/model.ts` — 純粋な物理モデル

「仮想世界の状態(`World`)」と、それを更新/観測する純関数だけ。DOM・タイマー・乱数を持たない＝完全にテスト可能。

```ts
// model.ts — 2Dシミュレータの物理(純粋)。姿勢の更新とセンサ観測だけを担う。
//
// World            … 仮想世界の状態(ロボットの姿勢)。部屋は SimConfig の矩形で表す。
// advance()        … 1ティック分、指令に従って姿勢を進める。
// readSensors()    … 現在の姿勢から Sensors(前方距離/yaw/離地)を作る。
import type { Sensors, Command } from "../types";

/** ロボットの姿勢。x,y は cm、yawDeg は度(0=+x方向, 反時計回りが +)。 */
export type Pose = { x: number; y: number; yawDeg: number };

/** 仮想世界の状態。今は姿勢だけ(部屋の形は SimConfig 側)。 */
export type World = { pose: Pose };

/** シムの物理パラメータ(仮想世界の設定)。config.ts とは責務が別。 */
export type SimConfig = {
  /** 部屋の幅 [cm](x: 0〜roomW)。 */
  roomW: number;
  /** 部屋の奥行き [cm](y: 0〜roomH)。 */
  roomH: number;
  /** speed=255 のとき1ティックで進む距離 [cm]。 */
  maxDriveCmPerTick: number;
  /** speed=255 のとき1ティックで回る角度 [度]。 */
  maxTurnDegPerTick: number;
};

/** 既定のシム設定(200×150cm の部屋)。 */
export const defaultSimConfig: SimConfig = {
  roomW: 200,
  roomH: 150,
  maxDriveCmPerTick: 4,
  maxTurnDegPerTick: 8,
};

/** 値を [min, max] に収める小ヘルパ。 */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * 1ティック分、指令に従って姿勢を進める(純関数:入力 world は壊さない)。
 *   forward     … 向いている方向へ前進(部屋の外には出ない＝壁で止まる)
 *   rotateLeft  … yaw を + 方向(反時計回り)へ
 *   rotateRight … yaw を − 方向(時計回り)へ
 *   stop        … 何もしない
 */
export function advance(w: World, cmd: Command, sc: SimConfig): World {
  const p = w.pose;

  if (cmd.kind === "forward") {
    const d = (cmd.speed / 255) * sc.maxDriveCmPerTick;
    const rad = (p.yawDeg * Math.PI) / 180;
    return {
      pose: {
        ...p,
        x: clamp(p.x + Math.cos(rad) * d, 0, sc.roomW), // 壁を越えない
        y: clamp(p.y + Math.sin(rad) * d, 0, sc.roomH),
      },
    };
  }

  if (cmd.kind === "rotateLeft" || cmd.kind === "rotateRight") {
    const a = (cmd.speed / 255) * sc.maxTurnDegPerTick;
    const sign = cmd.kind === "rotateLeft" ? 1 : -1;
    return { pose: { ...p, yawDeg: p.yawDeg + sign * a } }; // 連続値(折り返さない)
  }

  return w; // stop: 変化なし
}

/** 現在の姿勢から Sensors を観測する。離地はシムでは常に false。 */
export function readSensors(w: World, sc: SimConfig): Sensors {
  return {
    distanceCm: frontDistance(w.pose, sc),
    yawDeg: w.pose.yawDeg,
    lifted: false,
  };
}

/**
 * 前方の壁までの距離 [cm]。部屋は軸並行の矩形なので、
 * 内部の点から出る向きへの「箱の出口」までの距離を求める(レイキャスト)。
 */
function frontDistance(p: Pose, sc: SimConfig): number {
  const rad = (p.yawDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  let best = Infinity;

  // 各壁(x=0, x=roomW, y=0, y=roomH)までの距離 t を求め、向いている側だけ採用。
  if (dx > 0) best = Math.min(best, (sc.roomW - p.x) / dx);
  if (dx < 0) best = Math.min(best, (0 - p.x) / dx);
  if (dy > 0) best = Math.min(best, (sc.roomH - p.y) / dy);
  if (dy < 0) best = Math.min(best, (0 - p.y) / dy);

  return best; // 矩形は凸＝最小の正の t が前方の壁
}
```

### 補足：`frontDistance`（レイキャスト）の考え方

実機の超音波センサ（N=21）の代わりに、シムでは計算で「前方の壁までの距離」を出す。これが `frontDistance`。

- **やること**：ロボットの位置から、今向いている方向へまっすぐ線を1本伸ばし、最初にぶつかる壁までの長さ[cm]を求める。これを **レイキャスト**（ray=光線 / cast=放つ）と呼ぶ。レーザー距離計や超音波が「まっすぐ飛んで跳ね返る」のを模したもの。
- **なぜ簡単に解けるか**：部屋を **軸並行の矩形**（辺が x/y 軸に沿った長方形・家具なし）に限定しているから。ロボットは箱の内側にいるので、前方へ伸ばした線は必ずどこかの壁を内→外に突き抜ける＝「箱の出口」。その出口までが答え。

```
┌───────────×──┐   × が「箱の出口」(線が壁を抜ける点)
│      ●─────→  │   ● から × までの長さ = 前方の壁までの距離
│     (内側)     │
└───────────────┘
```

- **計算**：向き `(dx, dy) = (cos yaw, sin yaw)` は長さ1の矢印。各壁までの「軸方向の隔たり」を矢印のその成分で割ると、斜めに進んだ実距離 `t` が出る。
  - 例）右向き成分 `dx>0` のとき、右の壁 `x=roomW` まで横に `roomW - p.x` cm 離れていれば、実距離 `t = (roomW - p.x) / dx`。
  - 向いている側の壁だけを候補にし（`dx>0`なら右、`dx<0`なら左…）、**最小の `t`** が「最初にぶつかる壁」。矩形は凸なのでこれで必ず正しい出口になる。
- **直感**：横にゆっくり近づく向き（`dx` が小さい）ほど壁まで遠回り → `t` が伸びる。割り算がそれを表す。例 `90 / 0.5 = 180cm`。

---

## 3. `app/src/sim/model.test.ts` — 物理モデルのテスト

```ts
// model.test.ts — 物理モデルの振る舞い仕様(Vitest)
import { describe, it, expect } from "vitest";
import { advance, readSensors, defaultSimConfig } from "./model";
import type { World } from "./model";
import type { Command } from "../types";

const sc = defaultSimConfig; // 200×150, maxDrive=4, maxTurn=8

function world(x: number, y: number, yawDeg: number): World {
  return { pose: { x, y, yawDeg } };
}
const fwd = (speed: number): Command => ({ kind: "forward", speed });

describe("advance", () => {
  it("forward(yaw=0) → +x 方向へ maxDriveCmPerTick ぶん進む(speed=255)", () => {
    const w = advance(world(10, 75, 0), fwd(255), sc);
    expect(w.pose.x).toBeCloseTo(14); // 10 + 4
    expect(w.pose.y).toBeCloseTo(75); // 変化なし
  });

  it("forward は speed に比例(speed=128 ≒ 半分)", () => {
    const w = advance(world(10, 75, 0), fwd(128), sc);
    expect(w.pose.x).toBeCloseTo(10 + (128 / 255) * 4);
  });

  it("forward は壁を越えない(右端でクランプ)", () => {
    const w = advance(world(199, 75, 0), fwd(255), sc);
    expect(w.pose.x).toBe(200); // roomW で止まる
  });

  it("rotateLeft は yaw を増やす / rotateRight は減らす", () => {
    const l = advance(world(10, 10, 0), { kind: "rotateLeft", speed: 255 }, sc);
    const r = advance(world(10, 10, 0), { kind: "rotateRight", speed: 255 }, sc);
    expect(l.pose.yawDeg).toBeCloseTo(8);  // +maxTurn
    expect(r.pose.yawDeg).toBeCloseTo(-8); // -maxTurn
  });

  it("stop は姿勢を変えない", () => {
    const w = advance(world(10, 75, 30), { kind: "stop", speed: 0 }, sc);
    expect(w.pose).toEqual({ x: 10, y: 75, yawDeg: 30 });
  });

  it("純粋関数:入力 world を書き換えない", () => {
    const before = world(10, 75, 0);
    const snap = { pose: { ...before.pose } };
    advance(before, fwd(255), sc);
    expect(before).toEqual(snap);
  });
});

describe("readSensors", () => {
  it("前方(yaw=0)の壁まで距離 = roomW - x", () => {
    const s = readSensors(world(10, 75, 0), sc);
    expect(s.distanceCm).toBeCloseTo(190); // 200 - 10
  });

  it("後ろ向き(yaw=180)なら背後の壁(x=0)まで = x", () => {
    const s = readSensors(world(30, 75, 180), sc);
    expect(s.distanceCm).toBeCloseTo(30);
  });

  it("yaw と lifted をそのまま反映(離地は常に false)", () => {
    const s = readSensors(world(10, 75, 45), sc);
    expect(s.yawDeg).toBe(45);
    expect(s.lifted).toBe(false);
  });
});
```

---

## 配置と実行

```
app/src/
├── io/
│   └── robot.ts
└── sim/
    ├── model.ts
    └── model.test.ts
```

```bash
cd app
npm run test:run   # cleaning + model のテストが緑になる
npm run typecheck
```

OKなら実ファイルに落として commit。次は **段階2 第二弾**：`sim/sim-robot.ts`（model を `RobotIO` として見せる）→ `runner.ts`（read→step→send のループ）→ `ui.ts` / `index.html`（Canvas描画でシムを可視化）。
