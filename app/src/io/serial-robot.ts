// serial-robot.ts — Transport + protocol を束ねて RobotIO を実装(実機)。
import type { RobotIO } from "./robot";
import type { Transport } from "./transport";
import type { Sensors, Command } from "../types";
import {
    encodeCommand,
    encodeQueryDistance,
    encodeQueryLifted,
    encodeServo,
    parseFrame,
    decodeDistance,
    decodeLifted
} from "../protocol/protocol";

const TIMEOUT_MS = 1500;      // 1問い合わせの応答待ち上限

export class SerialRobot implements RobotIO {
    constructor(private tx: Transport) {}

    /** 距離→離地 を問い合わせて Sensors を組む。yaw は使わないので問い合わせない。 */
    async read(): Promise<Sensors> {
        const distanceCm = decodeDistance(await this.query(encodeQueryDistance("21"), "21"));
        const lifted = decodeLifted(await this.query(encodeQueryLifted("23"), "23"));
        // yaw(N=24)はファーム未実装、かつ頭脳はタイマー旋回で yaw を使わない。
        // 問い合わせると応答が来ず毎サイクル TIMEOUT_MS 待たされ、特にWiFiで体感2秒の遅延になる。
        // よって問い合わせず 0 を返す。
        return { distanceCm, yawDeg: 0, lifted };
    }

    /** 駆動指令を送る。ACK {H_ok} は次の query が H 不一致で読み飛ばす。 */
    async send(cmd: Command): Promise<void> {
        if (cmd.aimDeg !== undefined) await this.tx.write(encodeServo(cmd.aimDeg, "5")); // 首→
        await this.tx.write(encodeCommand(cmd, cmd.kind === "stop" ? "4" : "3"));        // 駆動
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


