// serial-robot.test.ts — 組み立てロジックを fake transport で検証(実機不要)
import { describe, it, expect } from "vitest";
import { SerialRobot } from "./serial-robot";
import type { Transport } from "./transport";

/** スクリプトしたフレームを順に返す fake。書き込みは記録するだけ。 */
class FakeTransport implements Transport {
    writes: string[] = [];
    private pending: string[] = [];

    // table: H(=N番号) → payload。例 { "21": "45", "23": "true" }
    constructor(private table: Record<string, string>, private noise = false) {}

    async write(d: string) { 
        this.writes.push(d);
        const h = String(JSON.parse(d).H);                  // 問い合わせの H を読む
        if (this.noise) this.pending.push("{99_noise}");    // 読み飛ばし検証用のノイズ
        if (this.table[h] !== undefined) {
            this.pending.push(`{${h}_${this.table[h]}}`);    // その H に対応する応答を用意
        }
    }

    async nextFrame(): Promise<string> {
        const f = this.pending.shift();
        if (f === undefined) throw new Error("timeout");
        return f;
    }
    
    async close() {}
}

describe("serialRobot", () => {
    it("read は距離/離地を組み立てる(yaw は問い合わせず0・接地→lifted false)", async () => {
        const tx = new FakeTransport({ "21": "45", "23": "true" });
        const s = await new SerialRobot(tx).read();
        expect(s).toEqual({ distanceCm: 45, yawDeg: 0, lifted: false });
        // yaw(N=24)は問い合わせない(応答が来ず毎回タイムアウトで遅くなるため)
        expect(tx.writes.some((w) => JSON.parse(w).N === 24)).toBe(false);
    });

    it("離地は lifted true(反転)", async () => {
        const tx = new FakeTransport({ "21": "30", "23": "false" });
        const s = await new SerialRobot(tx).read();
        expect(s.distanceCm).toBe(30);
        expect(s.lifted).toBe(true);
    });

    it("ノイズ(エコー/ACK)が混ざっても H で正しく拾う", async () => {
        const tx = new FakeTransport({ "21": "30", "23": "false" }, true);
        const s = await new SerialRobot(tx).read(); // 各 query が{99_noise}を飛ばし目的を拾う
        expect(s.distanceCm).toBe(30);
    });

    it("send は kind に応じた JSON を書く", async () => {
        const tx = new FakeTransport({});
        await new SerialRobot(tx).send({ kind: "forward", speed: 120 });
        expect(JSON.parse(tx.writes[0])).toMatchObject({ N: 3, D1: 3, D2: 120 });
    });

    it("send: aimDeg ありは 首(N=5)→駆動 の順", async () => {
        const tx = new FakeTransport({});
        await new SerialRobot(tx).send({ kind: "stop", speed: 0, aimDeg: 150 });
        expect(JSON.parse(tx.writes[0])).toMatchObject({ N: 5, D1: 1, D2: 150 });   // 先に首
        expect(JSON.parse(tx.writes[1])).toMatchObject({ N: 4 });                   // 後に停止
    });

    it("send: aimDeg なしは駆動のみ(サーボを動かさない)", async () => {
        const tx = new FakeTransport({});
        await new SerialRobot(tx).send({ kind: "reverse", speed: 80 });
        expect(tx.writes).toHaveLength(1);
    });
});
