// cleaning.ts — 掃除の判断ロジック(純粋状態機械)。副作用なし。
//
// 入力 (Sensors, State, Config) → 出力 (Command, 次の State) を決めるだけ。
// 優先順位: 安全(持ち上げ) → 相ごとの処理(drive / turn)
// 旋回完了は「turnTicks 回まわったら」で判定(タイマ旋回)。yaw は使わない(実機ジャイロが不安定なため)。

import type { Sensors, State, Config, Command, StepResult, TurnDir } from "../types";
import { chooseEscape } from "./scan-decision";

export function step(s: Sensors, st: State, cfg: Config): StepResult {
    // 旋回指令: 設定の向き(turnDir)に応じて左/右を選び、開始時・継続時で共通に使う。
    const fwd: Command = { kind: "forward", speed: cfg.driveSpeed };
    const stop: Command = { kind: "stop", speed: 0 };
    const rot = (d: TurnDir, aimDeg?: number): Command => ({ kind: d === "left" ? "rotateLeft" : "rotateRight", speed: cfg.turnSpeed, aimDeg });

    // 安全ゲート: 離地で停止(cfg.liftStop が true のときだけ)。
    // next は現在の相をそのまま返す＝床に戻れば中断地点から再開できる。
    if (cfg.liftStop && s.lifted) return { cmd: stop, next: st };

    switch (st.phase) {
        // 直進: 壁を見つけたら首を左へ向け、停止して scanLeft へ。
        case "drive": {
            const wallAhead = s.distanceCm > 0 && s.distanceCm < cfg.wallCm;
            if (!wallAhead) return { cmd: fwd, next: st};
            return { 
                cmd: { ...stop, aimDeg: cfg.scanLeftDeg },
                next: { ...st, phase: "scanLeft", leftCm: -1 }
            };
        }

        // 左を見た(整定済み): 左距離を記録し、首を右へ向けて scanRight へ。
        case "scanLeft":
            return {
                cmd: { ...stop, aimDeg: cfg.scanRightDeg },
                next: { ...st, phase: "scanRight", leftCm: s.distanceCm }
            };
        
        // 右を見た(整定済み): 逃げ方を決める。Config は openCm/turnDir を持つので EscapeParams として渡せる。
        case "scanRight": {
            const escape = chooseEscape(st.leftCm, s.distanceCm, cfg);  // "left"|"right"|"reverse"
            if (escape === "reverse") 
                return {
                    cmd: { kind: "reverse", speed: cfg.reverseSpeed, aimDeg: cfg.scanCenterDeg },
                    next: { ...st, phase: "reverse", reverseTicksLeft: cfg.reverseTicks, turnDir: cfg.turnDir }
                };
            return {
                cmd: rot(escape, cfg.scanCenterDeg),
                next: { ...st, phase: "turn", turnDir: escape, turnTicksLeft: cfg.turnTicks }
            };
        }

        // 後退: reverseTicks 回下がってから180度旋回へ。
        case "reverse":
            if (st.reverseTicksLeft <= 1)
                return { cmd: rot(st.turnDir), next: { ...st, phase: "turn", turnTicksLeft: cfg.turnTicks180 } };
            return { 
                cmd: { kind: "reverse", speed: cfg.reverseSpeed },
                next: { ...st, reverseTicksLeft: st.reverseTicksLeft - 1 }
            };
        
        // 旋回: turnTicks(90度) or turnTicks180(180度) 回まわって直進へ。
        case "turn":
            if (st.turnTicksLeft <= 1)
                return { cmd: fwd, next: { ...st, phase: "drive", turnTicksLeft: 0 }};
            return { cmd: rot(st.turnDir), next: { ...st, turnTicksLeft: st.turnTicksLeft - 1 }};
        
        // 全 Phase を処理した型保証。Phase を増減するとここがコンパイルエラーになり気付ける。
        default: { const _exhaustive: never = st.phase; throw new Error(`unhandled phase: ${_exhaustive}`); }
    }   
}
