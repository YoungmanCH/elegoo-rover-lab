# 段階5 追補：多重接続ガード（実機セッションの単一化）— TDD設計

> **課題**：`#connect`（USB）/`#connect-wifi`（WiFi）を **2回押す**、または **走行中に押す**と、旧 `realRunner` を止めないまま新しいものへ**変数を上書き**してしまう。結果：
> 1. **旧 runner がゾンビ化**（`setInterval` が生きたまま参照を失う）→ `emergencyStop` でも止められない（**安全に直結・最悪**）。
> 2. **旧 Transport がリーク**（WS二重TCP／シリアルポート占有）。
>
> **方針**：実機接続のライフサイクルを **`RobotSession` に隔離**し、「**旧を確実に閉じてから新を張る**」「**多重実行を弾く**」を保証する。`RobotSession` は openTransport / makeRunner を**注入**で受ける純粋寄りの部品にして、**fake で Vitest 先行（TDD）**。`main.ts` は薄い配線に戻す（[code-design.md](code-design.md) §3 のSRP）。

---

## 0. 現状の穴（再掲・確定）

出典＝`app/src/main.ts:30-79`。`realRunner` / `realRobot` を**上書きするだけで停止・解放していない**。

| ケース | 今の挙動 | 実害 |
|---|---|---|
| 接続を2回（開始前） | 旧 runner は `start()` 前でtic無し。だが**旧 tx は開いたまま放置** | WS二重TCP／ポート占有。純正firmwareは接続数>0で生き続ける |
| **走行中にもう一度接続** | `(realRunner ?? simRunner).start()` 済みで**旧 `setInterval` が生存**。変数だけ新へ差し替わり**旧runnerの参照を喪失** | **旧runnerが指令を送り続けるゾンビ**。`emergencyStop` は `session.runner?.stop()` で**新しい方しか止められない**＝**停止不能**。新旧2本が N=3 を二重送信 |
| USB↔WiFi を跨いで接続 | 上と同じ上書き＋**UNOのUARTをUSBとESP32が奪い合う**（[stage5-wireless-camera.md](stage5-wireless-camera.md) §7「両方つなぐと文字化け」） | ゾンビ化＋物理競合 |

> 核心は2つ：**(1) 走行中の再接続で旧runnerがゾンビ化し停止系を無効化**（段階4で作り込んだ「確実な緊急停止」を真正面から壊す）／**(2) 旧Transportのリーク**。

---

## 1. 設計判断

| 論点 | 決定 | なぜ |
|---|---|---|
| 責務の置き場 | **`app/src/session.ts` の `RobotSession`** に接続ライフサイクルを集約。`main.ts` は配線だけ | SRP（[code-design.md](code-design.md) §3）。`main.ts` の可変モジュール変数 `realRunner`/`realRobot` を1つの所有者に寄せ、上書きの穴を構造的に塞ぐ |
| 差し替え順 | **teardown-first**：旧を `stop()`＋`close()` してから新を `open()` | **二重runner（＝二重指令）を絶対に作らない**。新 `open()` が失敗しても結果は「停止＝安全側」。open-first だと失敗時まで一瞬2接続が生き、走行中の二重送信リスクが残る |
| 依存の向き | `connect(openTransport, makeRunner)` と **注入**で受ける | `RobotSession` を **USB/WS・config・onTick から独立**させる。fake transport / fake runner で**実機なし単体テスト**（[code-design.md](code-design.md) §7） |
| 多重実行ガード | **`busy` フラグ（ロジック）＋ ボタン `disabled`（UI）の二段** | `open()` 中（USBは自動リセット待ち~2秒）の**再入をロジックで弾き**、クリック自体も**UIで塞ぐ**。どちらか片方では穴が残る |
| `emergencyStop` | **据え置き**（接続は保持し stop 送信のみ）。切断は別操作 `disconnect()` | 段階4の「**再開できる**緊急停止」を壊さない。停止＝走行を止める、切断＝接続を畳む、は別物 |
| `close()` の失敗 | **握って続行**（`.catch(() => {})`） | 旧接続は既に切れている場合がある（WS切断・ポート喪失）。teardown が例外で止まると新接続に進めない |
| 切断時の停止保証 | disconnect は **close の前に `await robot.send(stop)`** | `runner.stop()` の stop は `void io.send`（投げっぱなし）で、直後の `close()`→`releaseLock()` と競合して未flush。**USBはハートビート自動停止が無く N=3(前進)のまま暴走**する。明示 await で確実化 |
| `makeRunner` 失敗 | 開いた **tx を close してから投げ直す**（ロールバック） | `openTransport()` 成功後に createRunner/onTick が投げると tx が宙に浮く＝ポート/WS リーク。内側 try で必ず閉じる |

---

## 2. TDD：先にテストを書く（`app/src/session.test.ts`）

`RobotSession` のライフサイクル（順序・ガード・冪等性・失敗時の安全側）を fake で固定する。read/send 等の中身は段階3で検証済みなので**ここでは扱わない**。

```ts
// session.test.ts — RobotSession のライフサイクルを fake で検証(実機不要)。
// 検証する不変条件: 「旧を止めて閉じてから新を張る」「多重実行を弾く」「失敗時は停止=安全側」。
import { describe, it, expect } from "vitest";
import { RobotSession } from "./session";
import type { Transport } from "./io/transport";
import type { Runner } from "./runner";

// 共有の log に「いつ何が起きたか」を時系列で積み、順序を検証する。
class FakeTransport implements Transport {
    closed = false;
    constructor(private id: string, private log: string[], private failClose = false) {}
    async write(_d: string): Promise<void> { this.log.push(`write:${this.id}`); } // stop 送信を可視化
    async nextFrame(_t: number): Promise<string> { return "{21_0}"; }
    async close(): Promise<void> {
        this.log.push(`close:${this.id}`);
        if (this.failClose) throw new Error("close failed"); // 切断後に close が投げる状況を再現
        this.closed = true;
    }
}
class FakeRunner implements Runner {
    started = false; stopped = false;
    constructor(private id: string, private log: string[]) {}
    start(): void { this.started = true; this.log.push(`start:${this.id}`); }
    stop(): void { this.stopped = true; this.log.push(`stop:${this.id}`); }
}

// id 付きの open/makeRunner を作るヘルパ(open 時刻も log に残す)
function openOk(id: string, log: string[]) {
    return async () => { log.push(`open:${id}`); return new FakeTransport(id, log); };
}
function mkRunner(id: string, log: string[]) {
    return () => new FakeRunner(id, log);   // robot 引数は使わない
}

describe("RobotSession", () => {
    it("初回接続: open→makeRunner が走り active になる", async () => {
        const log: string[] = [];
        const s = new RobotSession();
        const { runner } = await s.connect(openOk("t1", log), mkRunner("r1", log));
        expect((runner as FakeRunner).started).toBe(false); // 接続だけ。まだ走らせない(安全)
        expect(s.runner).toBe(runner);
        expect(log).toEqual(["open:t1"]);
    });

    it("再接続: 旧 stop → 旧 close の後に新 open(順序が肝)", async () => {
        const log: string[] = [];
        const s = new RobotSession();
        await s.connect(openOk("t1", log), mkRunner("r1", log));
        await s.connect(openOk("t2", log), mkRunner("r2", log));
        // 旧を完全に畳んでから新を開く。stop(write)→close→新open の順。二重runnerが生まれない。
        expect(log).toEqual(["open:t1", "stop:r1", "write:t1", "close:t1", "open:t2"]);
    });

    it("接続処理中の多重 connect は弾く(busy)", async () => {
        const log: string[] = [];
        const s = new RobotSession();
        let release!: (t: Transport) => void;
        const hang = () => new Promise<Transport>((r) => { release = r; }); // open が終わらない
        const p1 = s.connect(hang, mkRunner("r1", log));   // 進行中(busy=true)
        await expect(s.connect(openOk("t2", log), mkRunner("r2", log)))
            .rejects.toThrow("接続処理中");                 // 2回目は弾かれる
        release(new FakeTransport("t1", log));             // 後始末
        await p1;
    });

    it("disconnect: runner停止＋stop送信＋close を行い active を空にする", async () => {
        const log: string[] = [];
        const s = new RobotSession();
        const { runner } = await s.connect(openOk("t1", log), mkRunner("r1", log));
        await s.disconnect();
        expect((runner as FakeRunner).stopped).toBe(true);
        expect(s.runner).toBeNull();
        expect(s.robot).toBeNull();
        expect(log).toEqual(["open:t1", "stop:r1", "write:t1", "close:t1"]);
    });

    it("disconnect は接続前でも安全(何もしない)", async () => {
        const s = new RobotSession();
        await expect(s.disconnect()).resolves.toBeUndefined();
        expect(s.runner).toBeNull();
    });

    it("新 open が失敗したら active 無し=停止(安全側)", async () => {
        const log: string[] = [];
        const s = new RobotSession();
        await s.connect(openOk("t1", log), mkRunner("r1", log));         // 成功して active
        await expect(
            s.connect(() => Promise.reject(new Error("WS down")), mkRunner("r2", log)),
        ).rejects.toThrow("WS down");
        // 旧は teardown 済み・新は開けず → 接続なし=止まっている
        expect(s.runner).toBeNull();
        expect(log).toEqual(["open:t1", "stop:r1", "write:t1", "close:t1"]); // 旧を畳んだ所までで止まる
    });

    it("disconnect: stop コマンドを close より前に必ず送る(USB暴走防止)", async () => {
        const log: string[] = [];
        const s = new RobotSession();
        await s.connect(openOk("t1", log), mkRunner("r1", log));
        await s.disconnect();
        // runner.stop の stop は投げっぱなし(void io.send)。それに頼らず明示 stop を await→close。
        const w = log.indexOf("write:t1"), c = log.indexOf("close:t1");
        expect(w).toBeGreaterThanOrEqual(0);  // stop が実機へ出ている
        expect(w).toBeLessThan(c);            // ★stop が先・close が後(未flush暴走を防ぐ)
    });

    it("close() が投げても active は畳まれる(安全側)", async () => {
        const log: string[] = [];
        const s = new RobotSession();
        const openFail = async () => { log.push("open:t1"); return new FakeTransport("t1", log, true); };
        await s.connect(openFail, mkRunner("r1", log));
        await expect(s.disconnect()).resolves.toBeUndefined();  // throw が漏れない
        expect(s.runner).toBeNull();
        expect(s.robot).toBeNull();
    });

    it("makeRunner が open 後に投げたら tx を閉じてリークさせない", async () => {
        const log: string[] = [];
        const s = new RobotSession();
        let opened!: FakeTransport;
        const open = async () => { log.push("open:t1"); opened = new FakeTransport("t1", log); return opened; };
        await expect(
            s.connect(open, () => { throw new Error("runner build failed"); }),
        ).rejects.toThrow("runner build failed");
        expect(opened.closed).toBe(true);  // 開いた tx は閉じられている(リーク無し)
        expect(s.runner).toBeNull();
    });
});
```

> **この9本が守る不変条件**：①接続だけでは走らせない（段階4の安全方針）、②**順序＝旧stop→旧close→新open**（二重runner禁止）、③`open()`中の再入を弾く、④`disconnect`は冪等、⑤**失敗時は停止＝安全側**、⑥**stopはcloseより前に必ず実機へ届く**（USB暴走防止）、⑦**closeが投げてもactiveは畳む**、⑧**makeRunner失敗でも開いたtxを閉じる**（リーク無し）。`busy` の二段目（UIボタン）は副作用なので手動スモーク（§5）。

---

## 3. 実装：`app/src/session.ts`

```ts
// session.ts — 実機接続のライフサイクルを1点に隔離。
// 不変条件: 同時に生きる runner/Transport は最大1つ。差し替えは「旧を畳んでから新を張る」。
// USB/WS や config を知らない(openTransport/makeRunner を注入で受ける)ので fake で単体テスト可。
import type { Transport } from "./io/transport";
import type { Runner } from "./runner";
import { SerialRobot } from "./io/serial-robot";

export type ActiveSession = { robot: SerialRobot; runner: Runner };

export class RobotSession {
    private active: { tx: Transport; robot: SerialRobot; runner: Runner } | null = null;
    private busy = false;   // open() 進行中の再入を弾く(USB自動リセット待ち~2秒の間も含む)

    /** 緊急停止が直接 stop を送るため・開始が走らせるための参照(未接続は null)。 */
    get robot(): SerialRobot | null { return this.active?.robot ?? null; }
    get runner(): Runner | null { return this.active?.runner ?? null; }

    /**
     * 旧接続を確実に畳んでから新接続を張る。多重実行は弾く。
     * @param openTransport ユーザー操作内で Transport を開く(USB: requestPort / WS: 中継へ接続)
     * @param makeRunner    開いた robot から runner を組む(config/onTick は呼び元が決める)
     */
    async connect(
        openTransport: () => Promise<Transport>,
        makeRunner: (robot: SerialRobot) => Runner,
    ): Promise<ActiveSession> {
        if (this.busy) throw new Error("接続処理中");
        this.busy = true;
        try {
            await this.disconnect();              // ★旧を先に畳む(二重runnerを作らない=安全側)
            const tx = await openTransport();
            try {
                const robot = new SerialRobot(tx);
                const runner = makeRunner(robot); // 失敗しうる(createRunner / onTick)
                this.active = { tx, robot, runner };  // 走らせない=接続だけ(段階4の安全方針)
                return { robot, runner };
            } catch (e) {
                await tx.close().catch(() => {});   // 開いた tx を閉じてから投げ直す(リーク防止)
                throw e;
            }
        } finally {
            this.busy = false;
        }
    }

    /** 走行を止め、stop を確実に届けてから Transport を閉じる。「接続を畳む」操作。 */
    async disconnect(): Promise<void> {
        const a = this.active;
        if (!a) return;
        this.active = null;                       // 先に参照を切る(再入・取り違え防止)
        a.runner.stop();                          // ループを止める(以後 tic は送らない・段階4)
        // ★close の前に stop を「await して」送る。runner.stop の stop は void io.send(投げっぱなし)で、
        //   直後の close()→writer.releaseLock() が in-flight write と競合して throw・未flush になり得る。
        //   USB にはハートビート自動停止が無いので、stop が届かないと UNO は最後の N=3(前進)で暴走する。
        await a.robot.send({ kind: "stop", speed: 0 }).catch(() => {});
        await a.tx.close().catch(() => {});         // 接続解放(既に切れている場合があるので握る)
    }
}
```

> `disconnect()` が先に `this.active = null` してから後始末するのは、**畳んでいる最中に走るtic（busy防止の段階4 runner 側）や再入が、消えゆく接続を触らない**ようにするため。

---

## 4. `app/src/main.ts` への組み込み（差分）

可変モジュール変数 `realRunner`/`realRobot` を **`session` 1個に置換**し、接続2ハンドラを共通化、`emergencyStop` は session 経由に。

### 4-1. 宣言の置き換え

**Before（`main.ts:31-32`）**
```ts
let realRunner: Runner | null = null;
let realRobot: SerialRobot | null = null;
```
**After**
```ts
import { RobotSession } from "./session";
const session = new RobotSession();   // 実機接続の唯一の所有者(上書きの穴を構造的に塞ぐ)
```

### 4-2. `emergencyStop` を session 経由に（挙動は据え置き＝接続は畳まない）

**Before（`main.ts:35-42`）**
```ts
simRunner.stop();
realRunner?.stop();
for (let i = 0; i < 3; i++) {
    await realRobot?.send({ kind: "stop", speed: 0 }).catch(() => {});
}
```
**After**
```ts
simRunner.stop();
session.runner?.stop();
for (let i = 0; i < 3; i++) {
    await session.robot?.send({ kind: "stop", speed: 0 }).catch(() => {});
}
```

### 4-3. 開始ボタン

**Before**：`(realRunner ?? simRunner).start();`
**After** ：`(session.runner ?? simRunner).start();`

### 4-4. 接続2ハンドラを共通化＋ボタン無効化（多重クリックの二段目）

**Before（`main.ts:59-79` の2ハンドラ）** … 各々が `realRobot=` / `realRunner=` を**上書き**。
**After**
```ts
const connectBtn = document.querySelector<HTMLButtonElement>("#connect")!;
const wifiBtn = document.querySelector<HTMLButtonElement>("#connect-wifi")!;

// 共通: open 中はボタンを塞ぎ(再入の二段目)、session に旧畳み→新接続を任せる。
async function connect(openTransport: () => Promise<Transport>, okMsg: string): Promise<boolean> {
    connectBtn.disabled = wifiBtn.disabled = true;       // open 中は多重クリック不可
    try {
        await session.connect(openTransport, (robot) =>
            createRunner(robot, defaultConfig, initialState, (state, sensors, cmd) => {
                console.log(`[tick] dist=${sensors.distanceCm}cm phase=${state.phase} left=${state.turnTicksLeft} cmd=${cmd.kind}`);
            }),
        );
        console.log(okMsg);
        return true;
    } catch (e) {
        console.warn("接続失敗:", (e as Error).message);   // 失敗=未接続(安全側)。シムは使える
        return false;
    } finally {
        connectBtn.disabled = wifiBtn.disabled = false;   // 失敗でも再挑戦できるよう必ず戻す
    }
}

connectBtn.addEventListener("click", () => {
    void connect(() => SerialTransport.open(), "実機接続OK。『開始』で自走、『停止』/Esc/Spaceで停止。");
});

wifiBtn.addEventListener("click", async () => {
    const ok = await connect(() => WebSocketTransport.open(WS_URL), "WiFi接続OK。『開始』で自走、『停止』/Esc/Spaceで停止。");
    if (ok) {
        const cam = document.querySelector<HTMLImageElement>("#cam");
        if (cam) cam.src = CAM_URL;   // カメラはWiFi接続成功時だけ表示
    }
});
```

> `Transport` 型の import が要る場合は `import type { Transport } from "./io/transport";` を先頭に追加。`SerialTransport`/`WebSocketTransport`/`createRunner` の import は既存のまま。

---

## 5. 配置・実行・確認

```
app/src/
├── session.ts          (新規) 実機接続ライフサイクル
├── session.test.ts     (新規) fake でライフサイクル検証
└── main.ts             (差分) realRunner/realRobot → session に置換
```

```bash
cd app
npm run test:run     # session.test.ts(9本)が緑。既存も緑のまま
npm run typecheck    # main.ts の置換波及(Transport 型・session getter)を確認
grep -rn "realRunner\|realRobot" src/   # ★0件であること(置換漏れ=穴の残存)
npm run dev
```

**手動スモーク（穴が塞がったか）**
1. **連打**：`実機接続（USB）` を素早く2回 → ポート選択は1回だけ・コンソールに「接続処理中」 or 2回目クリックが効かない（disabled）。**二重接続にならない**。
2. **走行中の再接続**：USB接続→`開始`で自走中に **再度`実機接続`** → 旧runnerが止まり（`[tick]`が一旦途切れる）新接続に切替。**`停止`/Esc/Space で必ず止まる**（ゾンビが残らない）。
3. **USB↔WiFi 切替**：USBで走行中に `WiFi接続` → 旧（USB）を畳んでからWSへ。**二重送信もゾンビも無し**。
4. **失敗時**：中継未起動で `WiFi接続` → 「接続失敗」ログ＋**未接続（＝停止）**。ボタンは戻る。`開始` はシムにフォールバック。

---

## 6. つまずきポイント（厳密）

- **teardown-first の副作用**：新 `open()` が失敗すると**旧接続も畳まれて「未接続＝停止」**になる。これは仕様（安全側）。「失敗したら旧に戻る」挙動が欲しい場合は open-first へ変えるが、**走行中の二重送信リスクと引き換え**になるので非推奨。
- **`emergencyStop` と `disconnect` は別物**：停止＝走行を止める（接続は保持、`開始`で再開可）／切断＝接続を畳む。`emergencyStop` は段階4のまま接続を残す。混同して `emergencyStop` で `disconnect` すると、停止のたび再接続が要る。
- **`busy` だけでは不十分**：`busy` は**進行中の再入**を弾くが、**完了後の再クリック**は通る（teardown-first なので安全だが走行は止まる）。UIの `disabled` は open 中の連打対策で、**両方**が要る。
- **`close()` の例外は握る**：WS切断後・ポート喪失後は `close()` が投げ得る。握らないと teardown が途中で止まり次の接続に進めない。
- **切断時の stop は「await してから close」**：`runner.stop()` の stop は `void io.send`（投げっぱなし）。直後に `close()`→`releaseLock()` すると in-flight write と競合して throw・未flushになり、**USBはハートビート自動停止が無いので最後の N=3(前進)で暴走**する（[transport.ts](../../app/src/io/transport.ts) `close`／[runner.ts](../../app/src/runner.ts) `stop`）。disconnect は `await robot.send(stop)` を挟んでから close する。emergencyStop（主たる停止経路）は別途 3回 stop を送る（[stage4-wall-and-estop.md](stage4-wall-and-estop.md)）。
- **`makeRunner` 失敗のロールバック**：`openTransport()` 成功後に `makeRunner`(=createRunner/onTick) が投げると開いた tx が宙に浮く。connect は内側 try で**開いた tx を close してから投げ直す**（ポート/WS リーク防止）。
- **`disconnect()` は `busy` で守っていない**：今は `connect()` 内からのみ呼ぶ（busy 配下）ので安全。将来「切断ボタン」や `beforeunload` から**外部直呼びを足すなら**、connect の open 待ち中に active を消す TOCTOU を避けるため busy で直列化するか connect 内に閉じること。
- **WS再接続時の旧TCP**：ブラウザ側で旧WSを `close()` すれば ws-bridge の `cleanup` が走り旧TCPも閉じる → ESP32は接続数0で **`{"N":100}` 自動停止**（[stage5-wireless-camera.md](stage5-wireless-camera.md) §0/§7）。二重TCPが残らない。
- **テストの順序検証が本体**：`log` 配列の `["open:t1","stop:r1","close:t1","open:t2"]` が崩れたら**二重runnerの芽**。ここが赤くなったら teardown-first が壊れたサイン。

---
関連：[stage5-wireless-camera.md](stage5-wireless-camera.md)（WS/カメラ・ESP32自動停止）／ [stage4-wall-and-estop.md](stage4-wall-and-estop.md)（emergencyStop・runner.stop）／ [stage3-code-part2.md](stage3-code-part2.md)（Transport/SerialTransport・fake注入）／ [code-design.md](code-design.md) §3,§7
