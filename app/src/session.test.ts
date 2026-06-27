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
        expect((runner as FakeRunner).started).toBe(false);  // 接続だけ。まだ走らせない(安全)
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
        const hang = () => new Promise<Transport>((r) => { release = r;});  // open が終わらない
        const p1 = s.connect(hang, mkRunner("r1", log));       // 進行中(busy=true)
        await expect(s.connect(openOk("t2", log), mkRunner("r2", log)))
            .rejects.toThrow("接続処理中");                     // 2回目は弾かれる
        release(new FakeTransport("t1", log));                // 後始末
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
        await s.connect(openOk("t1", log), mkRunner("r1", log));    // 成功して active
        await expect(
            s.connect(() => Promise.reject(new Error("WS down")), mkRunner("r2", log)),
        ).rejects.toThrow("WS down");
        // 旧は teardown 済み・新は開けず → 接続なし=止まっている
        expect(s.runner).toBeNull();
        // 旧を畳んだ所までで止まる
        expect(log).toEqual(["open:t1", "stop:r1", "write:t1", "close:t1"]);
    });

    it("disconnect: stop コマンドを close より前に必ず送る(USB暴走防止)", async () => {
        const log: string[] = [];
        const s = new RobotSession();
        await s.connect(openOk("t1", log), mkRunner("r1", log));
        await s.disconnect();
        // runner.stop の stop は投げっぱなし(void io.send)。それに頼らず明示 stop を await→close。
        const w = log.indexOf("write:t1");
        const c = log.indexOf("close:t1");
        expect(w).toBeGreaterThanOrEqual(0);    // stop が実機へ出ている
        expect(w).toBeLessThan(c);              // ★stop が先・close が後(未flush暴走を防ぐ)
    });

    it("close() が投げても active は畳まれる(安全側)", async () => {
        const log: string[] = [];
        const s = new RobotSession();
        const openFail = async () => { log.push("open:t1"); return new FakeTransport("t1", log, true); };
        await s.connect(openFail, mkRunner("r1", log));
        await expect(s.disconnect()).resolves.toBeUndefined();   // throw が漏れない
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
        expect(opened.closed).toBe(true);   // 開いた tx は閉じられている(リーク無し)
        expect(s.runner).toBeNull();
    });
});
