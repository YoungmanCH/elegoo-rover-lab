# 段階1 コード草案（第一弾：`types.ts` / `config.ts`）

> **なぜこの2つを先に**：すべての層（domain / sim / protocol / io / ui）がこの「型＝契約」と「パラメータ」に依存する一方、この2ファイル自体は何にも依存しない。ここを固めてから `cleaning.ts` を書くと、テストもブレない。
> **位置づけ**：これはレビュー用の草案。OK が出たら実ファイル（`app/src/types.ts` / `app/src/config.ts`）に落とす。ロジック本体（`domain/cleaning.ts` ＋ テスト）は第二弾。
> 参照：[cleaning-logic-spec.md](cleaning-logic-spec.md) ／ [code-design.md](code-design.md)
> **更新**：旋回の向きを `turnDir` で切替（左/右）。`Command` に `rotateRight` 追加。コメントの丸カッコは半角 `()` に統一。

---

## 1. `app/src/types.ts` — 型＝契約

掃除ロジックがやり取りする「入力（センサ）」「出力（指令）」「内部状態」「設定」を型で固定する。
**ここには値もロジックも書かない**（数値は `config.ts`、判断は `cleaning.ts`）。単一責務＝「契約の宣言だけ」。

```ts
// types.ts — 掃除ロジックの契約(型のみ。値・ロジックは持たない)
//
// この4つはロジックの「入口・出口・記憶・調整つまみ」に対応する:
//   Sensors  … 入力(実機 or シムから来るセンサ値)
//   Command  … 出力(実機 or シムへ渡す“素の”指令)
//   State    … 内部状態(DRIVE/TURN の状態機械の記憶)
//   Config   … 調整つまみ(しきい値・速度。実体は config.ts)

/** ロボットから読む1ティック分のセンサ値。 */
export type Sensors = {
  /** 前方距離 [cm]。実機は N=21、シムはレイキャストで供給。 */
  distanceCm: number;

  /** 機体の向き(ヨー角)[度]。現状の brain では未使用(タイマー旋回)。実機 read() は yaw を問い合わせず 0 固定(N=24 は不採用)。 */
  yawDeg: number;

  /** 持ち上げ検知。true=床から離れている → 安全停止。実機は N=23。 */
  lifted: boolean;
};

/**
 * ロボットへ渡す“素の”駆動指令。判断結果をここに表すだけで、
 * JSON への変換は protocol 層(段階3)の責務。
 *   forward     … 直進(ジャイロ直進は UNO 側が担当)
 *   rotateLeft  … その場・左旋回
 *   rotateRight … その場・右旋回
 *   stop        … 停止(持ち上げ時など)
 */
export type Command = {
  kind: "forward" | "rotateLeft" | "rotateRight" | "stop";

  /** モータPWMデューティ(0–255, 8bit)。物理速度ではない。stop は 0。
   *  ※自走系モードでは実機側が 180 で上限クランプ(firmware 既定)。 */
  speed: number;
};

/**
 * 掃除ロジックの内部状態(DRIVE/TURN の2相)。
 *   phase="drive" … 壁まで直進中
 *   phase="turn"  … 旋回中。startYaw からの差が targetDeg に達したら drive へ戻る
 */
export type State = {
  phase: "drive" | "turn";

  /** 旋回を開始した瞬間のヨー角 [度]。turn 中だけ意味を持つ。 */
  startYaw: number;

  /** 今回の旋回で回したい角度 [度](基本 90、ジッタを足すこともある)。 */
  targetDeg: number;
};

/**
 * 調整つまみ(しきい値・速度・周期・旋回方向)。実体の値は config.ts に1か所だけ置く。
 * ロジック(cleaning.ts)は数値を直書きせず、必ずこの cfg を引数で受ける
 * ＝ ハードコーディング排除。
 */
export type Config = {
  /** これより近い前方距離で旋回に切り替える壁しきい値 [cm]。 */
  wallCm: number;

  /** 1回の旋回での目標角 [度]。 */
  turnDeg: number;

  /** 壁に当たったとき回る向き。"left"=左回り / "right"=右回り。 */
  turnDir: "left" | "right";

  /** 直進時のモータ速度。 */
  driveSpeed: number;

  /** 旋回時のモータ速度。 */
  turnSpeed: number;

  /** 制御ループの周期 [ms](read→step→send の間隔)。 */
  tickMs: number;
};

/** step() の戻り値:次に出す指令と、次ティックへ持ち越す状態。 */
export type StepResult = {
  cmd: Command;
  next: State;
};
```

---

## 2. `app/src/config.ts` — パラメータの唯一の置き場

しきい値・速度・周期・旋回方向を**ここだけ**に集約する。チューニングはこのファイルを触るだけ。
単一責務＝「既定値の宣言だけ」。ロジックは持たない。

```ts
// config.ts — 調整値の唯一の置き場(ハードコーディングの集約先)
//
// 値の根拠は cleaning-logic-spec.md。実機チューニングはここだけ書き換える。
import type { Config, State } from "./types";

/** 掃除ロジックの既定パラメータ。 */
export const defaultConfig: Config = {
  wallCm: 20,        // 20cm より近づいたら旋回(spec の既定)
  turnDeg: 90,       // 1回の旋回は 90 度(矩形をなぞる想定)
  turnDir: "left",   // 既定は左回り。"right" にすれば右回り
  driveSpeed: 120,   // 直進速度(控えめ＝壁検知の余裕を確保)
  turnSpeed: 150,    // 旋回速度(その場旋回は少し強めに)
  tickMs: 120,       // 制御周期(spec の目安 ~120ms)
};

/** 状態機械の初期状態:まず直進から始める。 */
export const initialState: State = {
  phase: "drive",
  startYaw: 0,
  targetDeg: 0,
};
```

---

## 次（第二弾）

→ [stage1-code-part2.md](stage1-code-part2.md)：`cleaning.test.ts`（先にテスト）→ `cleaning.ts`（通す実装）。左右どちらの旋回も検証。
