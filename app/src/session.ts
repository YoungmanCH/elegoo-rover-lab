// session.ts — 実機接続のライフサイクルを1点に隔離。
// 不変条件: 同時に生きる runner/Transport は最大1つ。差し替えは「旧を畳んでから新を張る」。
// USB/WS や config を知らない(openTransport/makeRunner を注入で受ける)ので fake で単体テスト可。
import type { Transport } from "./io/transport";
import type { Runner } from "./runner";
import { SerialRobot } from "./io/serial-robot";

export type ActiveSession = { robot: SerialRobot; runner: Runner };

export class RobotSession {
    private active: { tx: Transport; robot: SerialRobot; runner: Runner } | null = null;
    private busy = false;       // open() 進行中の再入を弾く(USB自動リセット待ち~2秒の間も含む)

    /** 緊急停止が直接 stop を送るため・開始が走らせるための参照(未接続は null)。 */
    get robot(): SerialRobot | null { return this.active?.robot ?? null };
    get runner(): Runner | null { return this.active?.runner ?? null };

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
            await this.disconnect();        // ★旧を先に畳む(二重runnerを作らない=安全側)
            const tx = await openTransport();
            try {
                const robot = new SerialRobot(tx);
                const runner = makeRunner(robot);   // 失敗しうる(createRunner / onTick)
                this.active = { tx, robot, runner };
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
        this.active = null;
        a.runner.stop();
        // ★close の前に stop を「await して」送る。runner.stop の stop は void io.send(投げっぱなし)で、
        //   直後の close()→writer.releaseLock() が in-flight write と競合して throw・未flush になり得る。
        //   USB にはハートビート自動停止が無いので、stop が届かないと UNO は最後の N=3(前進)で暴走する。
        await a.robot.send({ kind: "stop", speed: 0 }).catch(() => {});
        await a.tx.close().catch(() => {});     // 接続解放(既に切れている場合があるので握る)
    }
}

