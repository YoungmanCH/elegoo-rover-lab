# 段階3 コード草案（第一弾：`protocol/protocol.ts` ＋ テスト）

> **段階3のゴール**：シムと同じ brain・runner のまま、IO を実機（Web Serial）に差し替えて自走させる。
> **位置づけ**：レビュー用草案 → OKで実ファイルに落とす。段階3も2弾に分割。
> - **第一弾（この資料）**：`protocol/protocol.ts`（Command/センサ ⇔ シリアル文字列の変換）＋ `protocol.test.ts`。**純粋・ハード非依存でテスト可能**。
> - 第二弾：`io/transport.ts`（Web Serial 送受信）＋ `io/serial-robot.ts`（`RobotIO` 実機実装）＋ main で実機モードに切替。副作用側＝手動スモーク。
> 参照：[code-design.md](code-design.md) §5 ／ [code-reference-classes.md](../reference/code-reference-classes.md)

---

## 0. 実機プロトコル（ファーム実機コードで裏取り済み）

出典＝`SmartRobotCarV4.0_V1_20220303/ApplicationFunctionSet_xxx0.cpp`（行番号付き）。**サマリ任せにせず実コードで確認した**確定仕様:

### 送信（Web→UNO・JSON）
| やりたいこと | JSON | 出典 |
|---|---|---|
| 前進 | `{"H":"<id>","N":3,"D1":3,"D2":<speed>}` | `CMD_CarControl` 1126-1145（case3=Forward）|
| 左旋回 | `{"H":"<id>","N":3,"D1":1,"D2":<speed>}` | 同 case1=Left |
| 右旋回 | `{"H":"<id>","N":3,"D1":2,"D2":<speed>}` | 同 case2=Right |
| 停止 | `{"H":"<id>","N":4,"D1":0,"D2":0}` | case4 解析 1848-1855 ＋ 0/0で停止 1293 |

- **`D1` の数字**：`1=左 / 2=右 / 3=前進 / 4=後退`（`CMD_CarControl`）。※内部 enum（Forward=1…）とは別物なので注意。
- **`H` は必ず文字列**：ファームは `char *temp = doc["H"];`（1810-1812）で読むため、`{"H":1}`（数値）だと取れない。`{"H":"1"}` と**クオートして送る**。
- **停止は N=4 の 0/0**：N=3 の速度0でも止まるが、直進ジャイロ補正が残って微動し得る。安全停止（離地時）は確実な N=4 左右0/0 を使う。

### 受信（UNO→Web・JSONではない独自形式）
応答は **`{<H>_<payload>}`** という文字列（`'{' + CommandSerialNumber + '_' + … + '}'`）。**`JSON.parse` では読めない**ので自前で分解する。

| 問い合わせ | 送信 | 応答 | 出典 |
|---|---|---|---|
| 前方距離 | `{"H":"21","N":21,"D1":2}` | `{21_<cm>}`（整数） | `CMD_UltrasoundModuleStatus` 1517-1543（`is_get=2`で数値）|
| 離地 | `{"H":"23","N":23}` | `{23_true}`＝接地 / `{23_false}`＝離地 | case23 **1904-1916（反転）** |
| ヨー角 | `{"H":"24","N":24}` | `{24_<yaw>}` | **N=24 は自前追加（段階5）**。形式は距離に倣う |
| 駆動ACK | （上記N=3/4） | `{<H>_ok}` | 1844 など |

- **★離地は反転**：`Car_LeaveTheGround==true`（離地）で `_false`、接地で `_true` を返す。→ 我々の `lifted`（持ち上げ=true）は **`payload==="false"` のとき true**。
- **距離は D1=2 必須**：`D1=1` だと障害物有無の `true/false` が返り、数値が来ない。
- **ルーティング**：`H` は応答にそのまま echo される。問い合わせの `H` に **N番号（"21"/"23"/"24"）を入れておく**と、応答 `{21_..}` を見て「距離の答え」と判別できる（第二弾の serial-robot で使う）。

---

## 1. `app/src/protocol/protocol.ts` — 変換だけ（純粋）

```ts
// protocol.ts — 境界の契約(シリアル)のWeb側実装。Command/センサ ⇔ 文字列の変換だけ(純粋)。
//
// 送信: Command → 駆動JSON / 各センサの問い合わせJSON
// 受信: 実機応答 "{<H>_<payload>}" を分解し値へ変換
// 形式は ELEGOO ファームで確認済み(出典: stage3-code.md §0)。
import type { Command } from "../types"; // ← encodeCommand の引数型で使用(必須)

// N=3 の D1: 1=左 / 2=右 / 3=前進 / 4=後退 (CMD_CarControl)
const DRIVE_DIR = { forward: 3, rotateLeft: 1, rotateRight: 2 } as const;

/** Command → 送信JSON。H は文字列で送る(ファームが char* で読むため)。 */
export function encodeCommand(cmd: Command, h: string): string {
  if (cmd.kind === "stop") {
    // 確実な停止は N=4(左右モータ速度)の 0/0。N=3 速度0 は直進補正が残り得るため避ける。
    return JSON.stringify({ H: h, N: 4, D1: 0, D2: 0 });
  }
  return JSON.stringify({ H: h, N: 3, D1: DRIVE_DIR[cmd.kind], D2: cmd.speed });
}

/** 前方距離の問い合わせ(D1=2 で数値を返させる)。 */
export function encodeQueryDistance(h: string): string {
  return JSON.stringify({ H: h, N: 21, D1: 2 });
}

/** 離地の問い合わせ。 */
export function encodeQueryLifted(h: string): string {
  return JSON.stringify({ H: h, N: 23 });
}

/** ヨー角の問い合わせ(N=24 は自前追加・段階5)。 */
export function encodeQueryYaw(h: string): string {
  return JSON.stringify({ H: h, N: 24 });
}

export type Frame = { h: string; payload: string };

/** 応答フレーム "{<H>_<payload>}" を分解。形式外なら null。 */
export function parseFrame(s: string): Frame | null {
  const m = s.match(/^\{([^_}]+)_(.*)\}$/);
  return m ? { h: m[1], payload: m[2] } : null;
}

/** 距離[cm]。 */
export function decodeDistance(payload: string): number {
  return parseInt(payload, 10);
}

/** ヨー角[度]。 */
export function decodeYaw(payload: string): number {
  return parseFloat(payload);
}

/**
 * 離地(lifted)。★実機は反転:
 *   接地(床にいる)  → "true"   → lifted=false
 *   離地(持ち上げ)  → "false"  → lifted=true
 * なので payload==="false" のとき lifted=true。
 */
export function decodeLifted(payload: string): boolean {
  return payload === "false";
}
```

---

## 2. `app/src/protocol/protocol.test.ts` — 変換の単体テスト

```ts
// protocol.test.ts — シリアル文字列との相互変換の仕様(Vitest)
import { describe, it, expect } from "vitest";
import {
  encodeCommand, encodeQueryDistance, encodeQueryLifted, encodeQueryYaw,
  parseFrame, decodeDistance, decodeYaw, decodeLifted,
} from "./protocol";
// ※Command 型はテストでは未使用(コマンドはインラインのオブジェクトで渡すため import 不要)

describe("encodeCommand", () => {
  it("forward → N=3 D1=3, H は文字列", () => {
    const obj = JSON.parse(encodeCommand({ kind: "forward", speed: 120 }, "1"));
    expect(obj).toMatchObject({ H: "1", N: 3, D1: 3, D2: 120 });
    expect(typeof obj.H).toBe("string"); // 数値だとファームが読めない
  });

  it("rotateLeft → D1=1 / rotateRight → D1=2", () => {
    expect(JSON.parse(encodeCommand({ kind: "rotateLeft", speed: 150 }, "1"))).toMatchObject({ N: 3, D1: 1 });
    expect(JSON.parse(encodeCommand({ kind: "rotateRight", speed: 150 }, "1"))).toMatchObject({ N: 3, D1: 2 });
  });

  it("stop → N=4 D1=0 D2=0 (確実停止)", () => {
    expect(JSON.parse(encodeCommand({ kind: "stop", speed: 0 }, "1"))).toMatchObject({ N: 4, D1: 0, D2: 0 });
  });
});

describe("encodeQuery*", () => {
  it("distance は N=21 D1=2", () => {
    expect(JSON.parse(encodeQueryDistance("21"))).toMatchObject({ N: 21, D1: 2 });
  });
  it("lifted は N=23 / yaw は N=24", () => {
    expect(JSON.parse(encodeQueryLifted("23"))).toMatchObject({ N: 23 });
    expect(JSON.parse(encodeQueryYaw("24"))).toMatchObject({ N: 24 });
  });
});

describe("parseFrame", () => {
  it("{21_45} → h=21, payload=45", () => {
    expect(parseFrame("{21_45}")).toEqual({ h: "21", payload: "45" });
  });
  it("負の値/真偽も取れる", () => {
    expect(parseFrame("{24_-12.5}")).toEqual({ h: "24", payload: "-12.5" });
    expect(parseFrame("{23_true}")).toEqual({ h: "23", payload: "true" });
  });
  it("形式外は null", () => {
    expect(parseFrame("ok")).toBeNull();
    expect(parseFrame("{bad}")).toBeNull();
  });
});

describe("decode*", () => {
  it("distance を数値化", () => expect(decodeDistance("45")).toBe(45));
  it("yaw を数値化(負・小数)", () => expect(decodeYaw("-12.5")).toBeCloseTo(-12.5));

  it("★lifted は反転: 接地 true → false / 離地 false → true", () => {
    expect(decodeLifted("true")).toBe(false);  // 接地＝持ち上げではない
    expect(decodeLifted("false")).toBe(true);  // 離地＝持ち上げ
  });
});
```

---

## 配置と実行

```
app/src/protocol/
├── protocol.ts
└── protocol.test.ts
```

```bash
cd app
npm run test:run   # cleaning / model / sim-robot / protocol が緑
npm run typecheck
```

---

## 次（第二弾）と、要修正の既存doc

- **第二弾**：`io/transport.ts`（Web Serial で送受信＋受信バッファを `{...}` フレームに分割）→ `io/serial-robot.ts`（毎tick N=21/23/24 を問い合わせ、`H` で応答を振り分けて `Sensors` を組む）→ main に「シム/実機」切替を追加。Chrome/Edge・USB(CH340) で接続。
- **要修正（裏取りで判明）**：`cleaning-logic-spec.md §3` と `machine-reference` の **N=23 の向きが逆**（接地→`_true` が正）。承認をもらえれば両方を直す。
