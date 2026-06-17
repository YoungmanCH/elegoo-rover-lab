# 段階3 コード草案（第二弾：`io/transport.ts` ＋ `io/serial-robot.ts` ＋ main切替）

> **このゴール**：シムと同じ brain・runner のまま、IO を **Web Serial の実機**に差し替える。`protocol`（第一弾）の上に「実際の送受信」を載せる。
> **位置づけ**：レビュー用草案 → OKで実ファイルに落とす。副作用が主なので**手動スモーク**中心（純ロジックは fake で単体テスト）。
> 参照：[stage3-code.md](stage3-code.md)（protocol）／ [code-design.md](code-design.md) §3,§5

---

## 0. Web Serial の前提（ファーム実機コードで裏取り済み）

出典＝`ApplicationFunctionSet_xxx0.cpp`。

| 事実 | 値 | 出典 / 意味 |
|---|---|---|
| ボーレート | **9600** | `Serial.begin(9600)` :107。`port.open({baudRate:9600})` |
| 送信の終端 | **`}` で完結すればよい** | RX は `while (c != '}' ...)` :1777 で `}` まで読む。**改行不要**、`{...}` をそのまま送る |
| 受信フレーム | `{<H>_<payload>}` の文字列 | 値応答。`JSON.parse` 不可、`parseFrame` で分解 |
| エコー | 受信フレームを**毎回 echo** | :1788 `Serial.println(受信JSON)`。ただし `_` を含まない JSON なので `parseFrame`→null で自然に無視される |
| 自動リセット | open で Arduino がリセット | DTR トグルで再起動。**開いた直後 ~2秒は送信しない**（ブートローダ待ち） |
| secure context | https or **localhost** | `npm run dev`(localhost) はOK。Chrome/Edge のみ |

### 設計判断
| 論点 | 決定 | なぜ |
|---|---|---|
| センサ取得 | **1問い合わせずつ順番に**（距離→離地→yaw）request-response | UNO の RX バッファは64B。3問い合わせ同時はオーバーフロー risk。順次なら安全＆応答対応が明確 |
| 応答の対応付け | 問い合わせの `H` に N番号("21"等)を入れ、**H一致で拾う** | エコー/ACK/別センサが混ざっても取り違えない |
| テスト容易性 | `Transport` を**インターフェース化**し serial-robot に注入 | serial-robot の組み立てロジックは fake transport で単体テスト可。生の Web Serial だけ手動 |
| yaw の依存 | **N=24（段階5）が無いと yaw は来ない** | 段階3では「距離/離地の読取＋手動駆動」を検証。完全自走（旋回）は N=24 追加後 |

---

## 1. `app/src/io/transport.ts` — Web Serial 送受信（副作用の隔離）

```ts
// transport.ts — Web Serial の送受信を1点に隔離。受信は "{...}" フレーム単位で取り出す。
// ※Chrome/Edge のみ・secure context(https/localhost)必須。open で Arduino が自動リセット。

/** 送受信の契約。serial-robot はこれだけに依存(実機/ fake を差し替え可能)。 */
export interface Transport {
  write(data: string): Promise<void>;
  /** 次の "{...}" フレームを1つ返す。timeoutMs 超過で reject。 */
  nextFrame(timeoutMs: number): Promise<string>;
  close(): Promise<void>;
}

const BAUD = 9600; // ファーム Serial.begin(9600)

/** Web Serial 実装。open() はユーザー操作(クリック)の中で呼ぶこと。 */
export class SerialTransport implements Transport {
  // 受信は「いつ来るか分からない」非同期。背景の readLoop が作り手(producer)、
  // serial-robot が呼ぶ nextFrame() が受け手(consumer)。両者の速さのズレを次の3つの箱で吸収する:
  private buffer = "";                            // ① まだフレームに切れていない生テキスト("{21_4" のような途中受信も貯める)
  private frames: string[] = [];                 // ② 完成したが、まだ誰も取りに来ていないフレームの行列(=在庫)
  private waiters: ((f: string) => void)[] = []; // ③ 先に取りに来たが品が無くて待たせている要求(=注文)。各要素は「届いたら呼ぶ関数」
  private encoder = new TextEncoder();             // 文字列→バイト列(送信用)
  private decoder = new TextDecoder();             // バイト列→文字列(受信用)

  private constructor(
    private port: SerialPort,
    private writer: WritableStreamDefaultWriter<Uint8Array>,
  ) {}

  static async open(): Promise<SerialTransport> {
    const port = await navigator.serial.requestPort();   // ユーザー操作内で
    await port.open({ baudRate: BAUD });
    const writer = port.writable!.getWriter();
    const t = new SerialTransport(port, writer);
    void t.readLoop();                                   // 背景で受信し続ける
    await new Promise((r) => setTimeout(r, 2000));        // Arduino 自動リセット待ち
    return t;
  }

  private async readLoop(): Promise<void> {
    const reader = this.port.readable!.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        this.buffer += this.decoder.decode(value);
        this.extractFrames();
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** buffer から完成した "{...}" を取り出し、待ち人がいれば渡す。 */
  private extractFrames(): void {
    const re = /\{[^}]*\}/g;
    let m: RegExpExecArray | null;
    let last = 0;
    while ((m = re.exec(this.buffer))) {
      const frame = m[0];                  // 例: "{21_45}"
      const waiter = this.waiters.shift(); // 先に待っている要求(③)はあるか?
      if (waiter) waiter(frame);           // あれば即その注文に渡す(③が解決する)
      else this.frames.push(frame);        // 無ければ在庫(②)に積んでおく
      last = re.lastIndex;
    }
    this.buffer = this.buffer.slice(last); // 未完成の末尾("{21_4" 等)だけ buffer に残す
  }

  async write(data: string): Promise<void> {
    await this.writer.write(this.encoder.encode(data));
  }

  nextFrame(timeoutMs: number): Promise<string> {
    // すでに在庫(②)があれば、待たずに即返す
    const ready = this.frames.shift();
    if (ready) return Promise.resolve(ready);

    // 無ければ「届いたら resolve する関数」を waiters(③)に登録して待つ。
    // フレーム到着時に extractFrames が wrapped() を呼び、この Promise が解決する。
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        // timeoutMs 経っても来なければ、自分を待ち行列から外して諦める(例外)
        const i = this.waiters.indexOf(wrapped);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error("serial timeout"));
      }, timeoutMs);
      const wrapped = (frame: string) => { clearTimeout(timer); resolve(frame); };
      this.waiters.push(wrapped); // ③に並ぶ
    });
  }

  async close(): Promise<void> {
    this.writer.releaseLock();
    await this.port.close();
  }
}
```

### 補足：`buffer` / `frames` / `waiters` の関係（受信の心臓部）

受信は非同期で「いつ来るか分からない」。だから2人の役者がいる：
- **作り手（producer）**＝背景で回る `readLoop`：バイトが届くたび `buffer` に足し、完成した `{...}` を切り出す。
- **受け手（consumer）**＝`serial-robot` が呼ぶ `nextFrame()`：「次の1フレームをくれ」と要求する。

両者の速さは一致しないので、3つの箱で橋渡しする：

| 箱 | 中身 | たとえ |
|---|---|---|
| `buffer` | まだ切れていない生テキスト（`{21_4` のような途中も含む） | 切る前の素材 |
| `frames` | 完成したが、まだ取りに来られていないフレーム | **在庫** |
| `waiters` | 先に取りに来たが、品が無くて待たせている要求（「届いたら呼ぶ関数」） | **注文** |

動きは2パターンだけ：
- **品が先**（要求より先にフレーム到着）→ `frames` に積む → 後で `nextFrame()` が即取り出す。
- **注文が先**（フレームより先に要求）→ `waiters` に関数を登録 → 到着した瞬間 `extractFrames` がそれを呼んで解決。

正常時はどちらか一方だけが非空（在庫が捌けていれば注文待ち／注文が無ければ在庫が少し溜まる）。典型的な**生産者・消費者キュー**。`timeoutMs` は「注文しても品が来ない」時に諦める保険。

---

## 2. `app/src/io/serial-robot.ts` — `RobotIO` 実機実装

```ts
// serial-robot.ts — Transport + protocol を束ねて RobotIO を実装(実機)。
import type { RobotIO } from "./robot";
import type { Transport } from "./transport";
import type { Sensors, Command } from "../types";
import {
  encodeCommand, encodeQueryDistance, encodeQueryLifted, encodeQueryYaw,
  parseFrame, decodeDistance, decodeLifted, decodeYaw,
} from "../protocol/protocol";

const TIMEOUT_MS = 300; // 1問い合わせの応答待ち上限

export class SerialRobot implements RobotIO {
  constructor(private tx: Transport) {}

  /** 距離→離地→yaw を順に問い合わせて Sensors を組む。 */
  async read(): Promise<Sensors> {
    const distanceCm = decodeDistance(await this.query(encodeQueryDistance("21"), "21"));
    const lifted     = decodeLifted(await this.query(encodeQueryLifted("23"), "23"));
    const yawDeg     = decodeYaw(await this.query(encodeQueryYaw("24"), "24"));
    return { distanceCm, yawDeg, lifted };
  }

  /** 駆動指令を送る。ACK {H_ok} は次の query が H 不一致で読み飛ばす。 */
  async send(cmd: Command): Promise<void> {
    await this.tx.write(encodeCommand(cmd, cmd.kind === "stop" ? "4" : "3"));
  }

  /** request を送り、H が一致する応答 payload を返す。エコー/ACK/別センサは読み飛ばす。 */
  private async query(request: string, wantH: string): Promise<string> {
    await this.tx.write(request);
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      const raw = await this.tx.nextFrame(deadline - Date.now());
      const f = parseFrame(raw);
      if (f && f.h === wantH) return f.payload;
      // それ以外は無視して次のフレームへ
    }
    throw new Error(`no response for H=${wantH}`);
  }
}
```

---

## 3. `app/src/io/serial-robot.test.ts` — fake transport で単体テスト

```ts
// serial-robot.test.ts — 組み立てロジックを fake transport で検証(実機不要)
import { describe, it, expect } from "vitest";
import { SerialRobot } from "./serial-robot";
import type { Transport } from "./transport";

/**
 * 実機に近い fake：固定台本を順に流すのではなく、★書き込まれた問い合わせの H を見て
 * 対応する応答を積む(本物のUNOと同じ「聞かれたら答える」挙動)。
 * → read() の問い合わせ順を入れ替えても通る＝順番非依存。
 *   ※もし台本を順に返す素朴な fake にすると「台本順 == read()順」を強制してしまい、
 *     read() を並べ替えた時に query() が別Hのフレームを読み飛ばして timeout になる。
 * noise=true で毎回ノイズフレームを1つ混ぜ、query() の「H不一致は読み飛ばす」も検証できる。
 */
class FakeTransport implements Transport {
  writes: string[] = [];
  private pending: string[] = [];
  // table: H(=N番号) → payload。例 { "21": "45", "23": "true" }
  constructor(private table: Record<string, string>, private noise = false) {}

  async write(d: string) {
    this.writes.push(d);
    const h = String(JSON.parse(d).H);               // 問い合わせの H を読む
    if (this.noise) this.pending.push("{99_noise}"); // 読み飛ばし検証用のノイズ
    if (this.table[h] !== undefined) {
      this.pending.push(`{${h}_${this.table[h]}}`);  // その H に対応する応答を用意
    }
  }
  async nextFrame(): Promise<string> {
    const f = this.pending.shift();
    if (f === undefined) throw new Error("timeout");
    return f;
  }
  async close() {}
}

describe("SerialRobot", () => {
  it("read は距離/離地/yaw を組み立てる(接地→lifted false)", async () => {
    const tx = new FakeTransport({ "21": "45", "23": "true", "24": "-10.5" });
    const s = await new SerialRobot(tx).read();
    expect(s).toEqual({ distanceCm: 45, yawDeg: -10.5, lifted: false });
  });

  it("離地は lifted true(反転)", async () => {
    const tx = new FakeTransport({ "21": "30", "23": "false", "24": "0" });
    const s = await new SerialRobot(tx).read();
    expect(s.distanceCm).toBe(30);
    expect(s.lifted).toBe(true);
  });

  it("ノイズ(エコー/ACK)が混ざっても H で正しく拾う", async () => {
    const tx = new FakeTransport({ "21": "30", "23": "false", "24": "0" }, true);
    const s = await new SerialRobot(tx).read(); // 各 query が {99_noise} を飛ばして目的を拾う
    expect(s.distanceCm).toBe(30);
  });

  it("send は kind に応じた JSON を書く", async () => {
    const tx = new FakeTransport({});
    await new SerialRobot(tx).send({ kind: "forward", speed: 120 });
    expect(JSON.parse(tx.writes[0])).toMatchObject({ N: 3, D1: 3, D2: 120 });
  });
});
```

> **この fake が順番非依存な理由**：`write()` で「聞かれた H」を見て、その応答だけを `pending` に積む（実機と同じ「問い合わせ→その応答」）。だから `read()` 内の問い合わせを並べ替えても、各 `query()` は自分の応答だけを受け取る。逆に**固定台本を順に返す素朴な fake は「台本順＝read()順」を強制**し、並べ替えると別Hのフレームを読み飛ばして timeout する（＝順番依存になる）。**実機自体は順番非依存**（UNOが各問い合わせにその場で応答するため）なので、fake も実機に合わせている。

---

## 4. `app/src/main.ts` — 実機切替（スモーク）

実機は自己位置が無いので2D描画はしない。段階3では**通信が通るか**を確かめる小さなスモークを足す。
（完全自走は `createRunner(serialRobot, ...)` で**シムと同じ**に動くが、旋回には yaw＝**N=24（段階5）**が要る。）

```ts
// main.ts に追記（抜粋）：実機接続ボタン
import { SerialTransport } from "./io/transport";
import { SerialRobot } from "./io/serial-robot";

document.querySelector("#connect")!.addEventListener("click", async () => {
  const tx = await SerialTransport.open();   // ★ユーザー操作内で requestPort
  const robot = new SerialRobot(tx);

  // スモーク1: 距離/離地を数回読んでログ
  for (let i = 0; i < 5; i++) {
    console.log(await robot.read().catch((e) => `read失敗: ${e.message}`));
  }
  // スモーク2: 1秒前進して停止(実機が動くか)
  await robot.send({ kind: "forward", speed: 120 });
  await new Promise((r) => setTimeout(r, 1000));
  await robot.send({ kind: "stop", speed: 0 });
});
```

```html
<!-- index.html に1つ追加 -->
<button id="connect">実機接続（スモーク）</button>
```

> **yaw が無い段階での注意**：N=24 未実装だと `read()` の yaw 問い合わせが TIMEOUT で例外になる。スモーク中は `.catch` で握って距離/離地と駆動だけ確認する（上の例）。完全自走は段階5で N=24 を足してから `createRunner` に `SerialRobot` を渡す。

---

## 配置・実行・確認

```
app/src/io/
├── robot.ts          (既存)
├── transport.ts      (新規)
├── serial-robot.ts   (新規)
└── serial-robot.test.ts (新規)
```

```bash
cd app
npm run test:run   # protocol / serial-robot(fake) などが緑
npm run typecheck
npm run dev        # Chrome で localhost を開く
```

**実機確認（USBでUNO接続・Chrome）**：
1. 「実機接続（スモーク）」を押す → ポート選択（CH340）。
2. コンソールに距離/離地が出るか。
3. 車体が1秒前進して止まるか。

→ ここまで通れば「Web→実機」の経路が成立。**完全自走は段階5（N=24）後**。

---

## 次
- 段階4：`createRunner(serialRobot, defaultConfig, initialState, …)` で実機を自走（yaw 前提なので段階5と前後する）。
- 段階5：`arduino/SmartRobotCarV4.0_DIY` に `N=24`（Yaw返却）を追加。
- 任意：テレメトリUI①（`onTick` 拡張）／カメラ③（§6.1）。
