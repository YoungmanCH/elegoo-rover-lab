# 段階6d：逃げ方の判断 `chooseEscape`（純粋・kernel）

> **ゴール**：「左右の測定 → 逃げ方」を決める純粋関数 **`chooseEscape`** を作る。戻り値は **`"left" | "right" | "reverse"` の3択**。両側塞がり→後退の判断をこの1関数に集約し、型で守る。挙動はまだ無い（6eの状態機械が使う）＝**6b/6cと同じ「土台を先に固める」型**。
> **設計の肝（SRP/ISP）**：`chooseEscape` は判断に必要な値（**空き閾値 `openCm` と同値時の既定方向 `turnDir`**）だけを受け取る。`Config` 全体には依存しない＝**専用の小さな型 `EscapeParams` を切る**。これは sim が自分用の `SimConfig` を持つのと同じ発想（[sim/model.ts](../../app/src/sim/model.ts)）。おかげで本段は **`Config` に一切触らず自己完結**し、テストも `{ openCm, turnDir }` だけで済む（`reverseSpeed` 等は無関係）。
> **TDDの作法**：純粋関数だけ。「①テスト(RED)→②実装(GREEN)」で**全分岐を網羅**。`cleaning`/`config`/挙動には触れない。
> **前提**：[6c](stage6c-servo-aiming.md) まで。
> **このstageの位置**：[6a](stage6a-slowdown.md)→[6b](stage6b-reverse-command.md)→[6c](stage6c-servo-aiming.md)→**6d(本書)**→[6e](stage6e-scan-state-machine.md)。
> **編集はあなた**。括弧は半角。

---

## 0. この回の増分

| # | 増分 | 種別 | テスト |
|---|---|---|---|
| 1 | `types.ts`：`TurnDir` 型を導入（`Config.turnDir` をこの型に寄せる） | 型 | — |
| 2 | `domain/scan-decision.ts`：`Escape`/`EscapeParams` 型＋`isOpen`/`clearance`/`chooseEscape` | 新規・純 | **先に書く（網羅）** |

> **`Config` には触らない**：`openCm` の **値**を `defaultConfig` に足すのは、それを実際に使う側＝**6e**（`cleaning` が `chooseEscape` に `cfg` を渡すとき）。6dは判断ロジックと型だけ。
> **注意**：手元に旧 `chooseTurn`（2択・`Config`引数）が残っていたら**捨てる**。両側塞がりを表現できず要件を満たせない。

---

## 1. 増分1：`types.ts` に `TurnDir`

`Config` の `turnDir` は今 `"left" | "right"` の直書き。名前を付けて共有語彙にする：
```ts
/** 旋回の向き。 */
export type TurnDir = "left" | "right";
```
`Config.turnDir` の型も `TurnDir` に置き換える（**値は不変＝振る舞いは変わらない**ただの命名）：
```ts
// Before
turnDir: "left" | "right";
// After
turnDir: TurnDir;
```

## 2. 増分2：`domain/scan-decision.ts`（純粋・本段の主役）

### ① RED — `app/src/domain/scan-decision.test.ts`（全文）
`chooseEscape` が要るのは **空き閾値と既定方向だけ**。だから `Config` ではなく `EscapeParams` を渡す（`reverseSpeed` 等は登場しない＝6d単独で完結）。
```ts
import { describe, it, expect } from "vitest";
import { isOpen, clearance, chooseEscape } from "./scan-decision";
import type { EscapeParams } from "./scan-decision";

// chooseEscape の調整値は2つだけ。over で上書き。
const params = (o: Partial<EscapeParams> = {}): EscapeParams => ({ openCm: 30, turnDir: "left", ...o });

describe("isOpen", () => {
    it("エコー無し(0)は空き", () => expect(isOpen(0, 30)).toBe(true));
    it("openCm 未満は壁(塞がり)", () => expect(isOpen(29, 30)).toBe(false));
    it("openCm ちょうど/以上は空き", () => {
        expect(isOpen(30, 30)).toBe(true);
        expect(isOpen(100, 30)).toBe(true);
    });
});

describe("clearance", () => {
    it("エコー無し(0)は最も遠い扱い(Infinity)", () => expect(clearance(0)).toBe(Infinity));
    it("正の距離はそのまま", () => expect(clearance(40)).toBe(40));
});

// 並びは chooseEscape の分岐順(両塞→片側空き→両側空き)に合わせる。
describe("chooseEscape", () => {
    // 左右とも壁。どちらにも曲がれないので後退する(左右の値の大小は無関係)。
    it("両側とも壁(不等) → reverse", () => expect(chooseEscape(10, 12, params())).toBe("reverse"));
    it("両側とも壁(同値) → reverse", () => expect(chooseEscape(10, 10, params())).toBe("reverse"));
    it("両側とも壁(片方が閾値ぎりぎり下) → reverse", () => expect(chooseEscape(29, 5, params())).toBe("reverse"));

    // 片側だけ空いている → 空いている側へ。
    it("左だけ空き → left", () => expect(chooseEscape(50, 10, params())).toBe("left"));
    it("右だけ空き → right", () => expect(chooseEscape(10, 50, params())).toBe("right"));

    // 両側空き → 壁が遠い(広い)方へ。
    it("両側空き → 広い方(右が遠い)", () => expect(chooseEscape(40, 90, params())).toBe("right"));
    it("両側空き → 広い方(左が遠い)", () => expect(chooseEscape(90, 40, params())).toBe("left"));
    // エコー無し(0)は「壁が無い=最も遠い」扱いなので、その側が最も広い。
    it("片側がエコー無し(0) → その側が最も広い", () => expect(chooseEscape(0, 80, params())).toBe("left"));
    // 完全に同じ広さのときだけ、既定方向(turnDir)に倒す。
    it("両側空き・同値 → 既定方向(left)", () => expect(chooseEscape(50, 50, params())).toBe("left"));
    it("両側空き・同値 → 既定方向(right)", () => expect(chooseEscape(50, 50, params({ turnDir: "right" }))).toBe("right"));
});
```
### ② GREEN — `app/src/domain/scan-decision.ts`（全文）
```ts
// scan-decision.ts — 左右の測定から「逃げ方(Escape)」を決める純粋ルールだけ。
import type { TurnDir } from "../types";

/** 逃げ方: 左/右へ曲がる、または後退(+180)。 */
export type Escape = TurnDir | "reverse";

/** chooseEscape が必要とする調整値だけ(Config の部分集合)。Config をそのまま渡せる。 */
export type EscapeParams = {
    /** これ以上(or 0=エコー無し)で「空き」と見なす距離[cm]。 */
    openCm: number;
    /** 左右が同じ広さのときに倒す既定方向。 */
    turnDir: TurnDir;
};

/** エコー無し(0)=遠い、または openCm 以上なら「空き」。 */
export function isOpen(distanceCm: number, openCm: number): boolean {
    return distanceCm === 0 || distanceCm >= openCm;
}

/** 比較用クリアランス。エコー無し(0)は最も遠い＝Infinity。 */
export function clearance(distanceCm: number): number {
    return distanceCm === 0 ? Infinity : distanceCm;
}

/**
 * 左右の距離から逃げ方を決める。
 *   両側とも壁 → "reverse"(どちらにも曲がれない＝後退して180度)
 *   片側だけ空き → その側へ
 *   両側空き     → 壁が遠い(広い)方へ。完全同値のときだけ p.turnDir
 */
export function chooseEscape(leftCm: number, rightCm: number, p: EscapeParams): Escape {
    const l = isOpen(leftCm, p.openCm);
    const r = isOpen(rightCm, p.openCm);
    if (!l && !r) return "reverse";                 // 左右とも壁 → 後退(値の大小は無関係)
    if (l && !r) return "left";                     // 左だけ空き
    if (r && !l) return "right";                    // 右だけ空き
    const cl = clearance(leftCm), cr = clearance(rightCm);   // 両側空き → 広い方へ
    if (cl === cr) return p.turnDir;                // 完全同値のときだけ既定方向
    return cl > cr ? "left" : "right";
}
```

> **なぜ `EscapeParams`（`Config`でなく）**：`chooseEscape` は `openCm` と `turnDir` しか使わない。`Config` 全体を要求すると、本段と無関係な `reverseSpeed`/`turnTicks` 等までテストで用意せねばならず、**6d単独でテストできなくなる**（実際それが起きていた）。必要な分だけ受ければ、テストは `{ openCm, turnDir }` だけ。`Config` は `openCm`/`turnDir` を持つので、6eで `chooseEscape(l, r, cfg)` と**そのまま渡せる**（構造的部分型）。

---

## 3. 充足（この関数だけで判断は完結）

| 入力の状況 | 期待 | テスト |
|---|---|---|
| 両側とも壁（不等/同値/閾値際） | reverse | chooseEscape ×3 |
| 左だけ空き / 右だけ空き | left / right | ×2 |
| 両側空き・広い方 / 同値 / エコー無し | 広い方 / turnDir / その側 | ×4 |
| `isOpen` 境界（0 / openCm-1 / openCm） | — | ×3 |
| `clearance`（0=∞ / 正） | — | ×2 |

→ **逃げ方の判断は本段で網羅済み**。残るは「この判断を相にどう繋ぐか（首振り・後退の実行）」で6e。

## 4. 実行・確認
```bash
cd app
npm run test:run    # scan-decision.test が全分岐で緑
npm run typecheck   # TurnDir 導入の波及が無いこと(Config.turnDir の命名のみ)
```
- 本段は**純粋関数のみ**＝手動確認なし・`config.ts`変更なし。挙動は6eで通し検証。
- 完了：scan-decision.test 緑＋typecheck緑。

---
関連：[stage6 インデックス](stage6-scan-and-reverse.md)／ [code-design.md](code-design.md)（純粋＝Vitest先行・依存逆転）／ 次：[6e スキャンの状態機械](stage6e-scan-state-machine.md)
