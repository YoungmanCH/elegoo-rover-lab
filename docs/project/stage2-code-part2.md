# 段階2 コード草案（第二弾：シムを動かして見る）

> **このゴール**：ブラウザを開くと、2Dの部屋の中をロボット（丸＋向き矢印）が掃除ロジックで自走し、壁で旋回する様子が見える。実機ゼロ。
> **位置づけ**：レビュー用草案 → OKで実ファイルに落とす。第一弾（[stage2-code.md](stage2-code.md)）の `RobotIO` / `model` の上に、glue・ループ・描画を載せる。
> 参照：[code-design.md](code-design.md) ／ [stage2-code.md](stage2-code.md)

---

## 設計判断（先に固める）

| 論点 | 決定 | なぜ |
|---|---|---|
| Vite のエントリ（組み立て役） | **`main.ts` を1つ追加**し、ここで部品を繋ぐ（composition root）。`ui.ts` は純粋な描画だけに保つ | 「部品を繋ぐ配線」と「描画」は別責務。`ui.ts=DOM・描画` の単一責務を守るため、配線は `main.ts` に分離。※`code-design.md` §3 のツリーに `main.ts` を追記する |
| 非同期の重なり | `runner` に `busy` ガードを入れ、前ティックの read/send が終わるまで次を始めない | 実機の Web Serial は read/send に時間がかかる。重なると指令が前後する。シムでも同じループで安全 |
| 描画の y 反転 | cm座標の y（奥=大きいほど上）を、Canvas の y（下向き）へ `roomH - y` で反転 | 数学の向き（上が +y）と画面の向き（下が +y）が逆だから |
| テスト | `sim-robot` は単体テスト（決定的）。`runner`/`ui`/`main` は**手動スモーク**（アプリを開いて目視） | 副作用・タイマー・DOM が絡む層は単体コスト過大。spec の方針どおり |

---

## 1. `app/src/sim/sim-robot.ts` — model を `RobotIO` として見せる

世界の状態 `World` を内部に保持し、`read()`/`send()` で観測・更新する。`runner` から見れば実機と同じ顔（`RobotIO`）。

```ts
// sim-robot.ts — model を RobotIO として実装するシム。世界の状態を内部に持つ。
import type { RobotIO } from "../io/robot";
import type { Sensors, Command } from "../types";
import type { World, SimConfig } from "./model";
import { advance, readSensors, defaultSimConfig } from "./model";

export class SimRobot implements RobotIO {
  private world: World;
  private sc: SimConfig;

  constructor(initial: World, sc: SimConfig = defaultSimConfig) {
    this.world = initial;
    this.sc = sc;
  }

  /** 現在の姿勢からセンサ値を観測(即解決)。 */
  async read(): Promise<Sensors> {
    return readSensors(this.world, this.sc);
  }

  /** 指令で世界を1ティック進める。 */
  async send(cmd: Command): Promise<void> {
    this.world = advance(this.world, cmd, this.sc);
  }

  /** 描画用に現在の世界を覗く(読み取り専用の用途)。
   *  ※RobotIO の契約外。シムだと知っている描画側だけが使う。 */
  getWorld(): World {
    return this.world;
  }
}
```

---

## 2. `app/src/runner.ts` — 制御ループ（read→step→send）

`tickMs` ごとに「読む→判断→送る」を回し、`State`（脳の状態）を持ち回す。`RobotIO` だけに依存（実機/シム共通）。

```ts
// runner.ts — 制御ループ。tick ごとに read→step→send を回し、State を持ち回す。
import type { RobotIO } from "./io/robot";
import type { Config, State } from "./types";
import { step } from "./domain/cleaning";

export type Runner = {
  start(): void;
  stop(): void;
};

/**
 * 制御ループを作る。io は実機/シムどちらでもよい(RobotIO)。
 * onTick: 各ティック後に呼ばれる(描画などの観測用)。
 */
export function createRunner(
  io: RobotIO,
  cfg: Config,
  initial: State,
  onTick?: (state: State) => void,
): Runner {
  let state = initial;
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false; // 前ティックの非同期処理が終わるまで次を始めない

  async function tick(): Promise<void> {
    if (busy) return; // 重なり防止(実機の read/send は時間がかかる)
    busy = true;
    try {
      const sensors = await io.read();
      const { cmd, next } = step(sensors, state, cfg);
      await io.send(cmd);
      state = next;
      onTick?.(state);
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      if (timer) return; // 二重起動を防ぐ
      timer = setInterval(tick, cfg.tickMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
```

---

## 3. `app/src/ui.ts` — Canvas 描画（純粋な描画だけ）

世界を受け取って絵にするだけ。状態もロジックも持たない（配線は `main.ts`）。

```ts
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

/** 世界を1フレーム描く(部屋の枠 + ロボットの位置と向き)。 */
export function draw(ctx: CanvasRenderingContext2D, world: World, sc: SimConfig): void {
  const { canvas } = ctx;
  const scale = scaleFor(canvas, sc);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 部屋の枠
  ctx.strokeStyle = "#888";
  ctx.strokeRect(0, 0, sc.roomW * scale, sc.roomH * scale);

  // ロボット本体(丸)
  const { x, y, yawDeg } = world.pose;
  const p = toPx(x, y, sc, scale);
  const r = 6;
  ctx.fillStyle = "#2b8a3e";
  ctx.beginPath();
  ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
  ctx.fill();

  // 向きの矢印(yaw方向。画面yは下向きなので sin の符号を反転)
  const rad = (yawDeg * Math.PI) / 180;
  ctx.strokeStyle = "#2b8a3e";
  ctx.beginPath();
  ctx.moveTo(p.px, p.py);
  ctx.lineTo(p.px + Math.cos(rad) * r * 2.5, p.py - Math.sin(rad) * r * 2.5);
  ctx.stroke();
}
```

### 補足：Canvas 2D 描画の基本（`draw` で使っている命令）

Canvas は「描いたものが上に積み重なって残る」キャンバス。`ctx`（2D描画コンテキスト）に命令を出して絵を描く。`draw` で使っている命令:

| 命令 | 何をする |
|---|---|
| `ctx.clearRect(x, y, w, h)` | 指定した長方形を**消して透明に戻す**。毎フレーム最初に画面全体を消す“消しゴム”。これが無いとロボットの残像が全部残る |
| `ctx.strokeRect(x, y, w, h)` | 長方形の**枠線**を描く（部屋の枠）|
| `ctx.fillStyle` / `ctx.strokeStyle` | これから描く**塗り色 / 線の色**を設定 |
| `ctx.beginPath()` | 新しい線/図形の**描き始め**を宣言（前の線と繋がらないように区切る）|
| `ctx.arc(cx, cy, r, 0, Math.PI*2)` | 中心 `(cx,cy)`・半径 `r` の**円**を描く（`0〜2π`＝1周＝丸。ロボット本体）|
| `ctx.fill()` | 直前の path を**塗りつぶす**（円を塗る）|
| `ctx.moveTo(x, y)` / `ctx.lineTo(x, y)` | ペンを移動 / そこへ**線を引く**（向き矢印）|
| `ctx.stroke()` | 直前の path を**線として描画**する |

**毎フレームの流れ**：`clearRect`（消す）→ 部屋の枠 → ロボットの丸 → 向き矢印、の順で「今の状態」を1枚描く。`runner` の `onTick` がティックごとに `draw` を呼ぶので、これが連続して“動いて見える”。

> `clearRect` の引数 `(0, 0, canvas.width, canvas.height)` は「左上(0,0)から Canvas 全面」＝画面まるごとクリア、の意味。

---

## 4. `app/src/main.ts` — 組み立て（composition root / Vite エントリ）

部品を繋いでボタンに配線するだけ。ここだけが「どの実装を使うか(シム)」を知る。

```ts
// main.ts — シムデモの組み立て。部品を繋ぎ、ボタンに配線するだけ(ロジックは持たない)。
import { defaultConfig, initialState } from "./config";
import { defaultSimConfig } from "./sim/model";
import type { World } from "./sim/model";
import { SimRobot } from "./sim/sim-robot";
import { createRunner } from "./runner";
import { draw } from "./ui";

const canvas = document.querySelector<HTMLCanvasElement>("#sim")!;
const ctx = canvas.getContext("2d")!;

// 左寄り・右向きで開始(部屋の中で適当な初期姿勢)
const initialWorld: World = {
  pose: { x: 20, y: defaultSimConfig.roomH / 2, yawDeg: 0 },
};
const robot = new SimRobot(initialWorld, defaultSimConfig);

// 各ティック後に最新の世界を描く
const runner = createRunner(robot, defaultConfig, initialState, () => {
  draw(ctx, robot.getWorld(), defaultSimConfig);
});

draw(ctx, robot.getWorld(), defaultSimConfig); // 初期状態を1回描く

document.querySelector("#start")!.addEventListener("click", () => runner.start());
document.querySelector("#stop")!.addEventListener("click", () => runner.stop());
```

---

## 5. `app/index.html` — 画面（Canvas ＋ ボタン）

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>自作ルンバ シミュレータ</title>
  </head>
  <body>
    <h1>掃除シミュレータ（段階2）</h1>
    <canvas id="sim" width="600" height="450" style="border:1px solid #ccc"></canvas>
    <div>
      <button id="start">開始</button>
      <button id="stop">停止</button>
    </div>
    <!-- Vite のエントリ。main.ts が全部を組み立てる -->
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

> Canvas 600×450 は部屋 200×150cm と同じ縦横比(×3)。`scaleFor` が `min(600/200, 450/150)=3` を返すので歪まない。

---

## 6. `app/src/sim/sim-robot.test.ts` — シム実装の単体テスト（決定的なので入れる）

```ts
// sim-robot.test.ts — SimRobot が read/send で世界を正しく観測・更新するか
import { describe, it, expect } from "vitest";
import { SimRobot } from "./sim-robot";
import { defaultSimConfig } from "./model";
import type { World } from "./model";

const sc = defaultSimConfig;
const world = (x: number, y: number, yawDeg: number): World => ({ pose: { x, y, yawDeg } });

describe("SimRobot", () => {
  it("read は現在の姿勢からセンサを返す", async () => {
    const robot = new SimRobot(world(10, 75, 0), sc);
    const s = await robot.read();
    expect(s.distanceCm).toBeCloseTo(190); // 200 - 10
    expect(s.yawDeg).toBe(0);
    expect(s.lifted).toBe(false);
  });

  it("send(forward) で世界が前進し、次の read に反映される", async () => {
    const robot = new SimRobot(world(10, 75, 0), sc);
    await robot.send({ kind: "forward", speed: 255 });
    const s = await robot.read();
    expect(s.distanceCm).toBeCloseTo(186); // x:14 → 200-14
  });

  it("send(stop) は世界を変えない", async () => {
    const robot = new SimRobot(world(10, 75, 0), sc);
    await robot.send({ kind: "stop", speed: 0 });
    expect(robot.getWorld().pose).toEqual({ x: 10, y: 75, yawDeg: 0 });
  });
});
```

---

## 配置・実行・確認

```
app/
├── index.html
└── src/
    ├── main.ts
    ├── runner.ts
    ├── ui.ts
    └── sim/
        ├── sim-robot.ts
        └── sim-robot.test.ts
```

```bash
cd app
npm run test:run   # cleaning / model / sim-robot が緑
npm run typecheck
npm run dev        # 表示された localhost を Chrome で開く → 「開始」で自走、壁で旋回
```

**目視で確認したいこと**：ロボットが前進 → 壁の手前(20cm)で左旋回 → また前進、を繰り返す。`config.ts` の `turnDir` を `"right"` にすれば右回りになる。

---

## この弾での設計上の追記（要承認）

- **`main.ts` を新設**（Vite エントリ＝組み立て役）。`ui.ts` は描画専任のまま。→ これに合わせて `code-design.md` §3 のツリーに `main.ts` を1行追記したい。
- これで段階2は完了（シム上で掃除が動く）。次は段階3：`protocol.ts`（Command⇄JSON）＋ `transport.ts`（Web Serial）＋ `serial-robot.ts`（実機の RobotIO）。**brain も runner もそのまま、IO を差し替えるだけ**で実機に繋がる。
