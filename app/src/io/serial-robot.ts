// serial-robot.ts — Transport + protocol を束ねて RobotIO を実装(実機)。
import type { RobotIO } from "./robot";
import type { Transport } from "./transport";
import type { Sensors, Command } from "../types";
import {
    encodeCommand,
    encodeQueryDistance,
    encodeQueryLifted,
    encodeQueryYaw,
    parseFrame,
    decodeDistance,
    decodeLifted,
    decodeYaw
} from "../protocol/protocol";

const TIMEOUT_MS = 1500;      // 1問い合わせの応答待ち上限

export class SerialRobot implements RobotIO {
    constructor(private tx: Transport) {}

    /** 距離→離地→yaw を順に問い合わせて Sensors を組む。 */
    async read(): Promise<Sensors> {
        const distanceCm = decodeDistance(await this.query(encodeQueryDistance("21"), "21"));
        // 変更後（N=24 が無い間は yaw=0 扱いにして read を成功させる）
        const yawDeg = await this.query(encodeQueryYaw("24"), "24").then(decodeYaw).catch(() => 0);
        const lifted = decodeLifted(await this.query(encodeQueryLifted("23"), "23"));
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


