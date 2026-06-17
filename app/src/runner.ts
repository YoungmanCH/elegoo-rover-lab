// runner.ts — 制御ループ。tick ごとに read→step→send を回し、State を持ち回す。
import type { RobotIO } from "./io/robot";
import type { Config, State, Sensors, Command } from "./types";;
import { step } from "./domain/cleaning";

export type Runner = {
    start(): void;
    stop(): void;
}

/**
 * 制御ループを作る。io は実機/シムどちらでもよい(RobotIO)。
 * onTick: 各ティック後に呼ばれる(描画などの観測用)。
 */
export function createRunner(
    io: RobotIO,
    cfg: Config,
    initial: State,
    onTick?: (state: State, sensors: Sensors, cmd: Command) => void,
): Runner {
    let state = initial;
    let timer: ReturnType<typeof setInterval> | null = null;
    let busy = false;           // 前ティックの非同期処理が終わるまで次を始めない
    let running = false;        // 停止後に「居残りの tick」が指令を送るのを防ぐ


    async function tick(): Promise<void> {
        if (busy || !running) return;   // 重なり防止＋停止後は何もしない
        busy = true;
        try {
            const sensors = await io.read();
            const { cmd, next } = step(sensors, state, cfg);
            if (!running) return;            // 停止が押されていたら送信しない
            await io.send(cmd);
            state = next;
            onTick?.(state, sensors, cmd);   // 観測(描画/テレメトリ)用にセンサ・指令も渡す
        } finally {
            busy = false;
        }
    }

    return {
        start() {
            if (timer) return;  // 二重起動を防ぐ
            running = true;
            timer = setInterval(tick, cfg.tickMs);
        },
        stop() {
            running = false;
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            // ループ停止だけでは実機は最後の前進(N=3 は時間無制限)で走り続ける。明示的に止める。
            void io.send({ kind: "stop", speed: 0 });
        }
    };
}
