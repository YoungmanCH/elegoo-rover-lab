// cleaning.ts — 掃除の判断ロジック(純粋状態機械)。副作用なし。
//
// 入力 (Sensors, State, Config) → 出力 (Command, 次の State) を決めるだけ。
// 優先順位: 安全(持ち上げ) → 相ごとの処理(drive / turn)
// 旋回完了は「turnTicks 回まわったら」で判定(タイマ旋回)。yaw は使わない(実機ジャイロが不安定なため)。

import type { Sensors, State, Config, Command, StepResult } from "../types";

export function step(s: Sensors, st: State, cfg: Config): StepResult {
    // 旋回指令: 設定の向き(turnDir)に応じて左/右を選び、開始時・継続時で共通に使う。
    const turnCmd: Command = {
        kind: cfg.turnDir === "right" ? "rotateRight" : "rotateLeft",
        speed: cfg.turnSpeed,
    };

    // 安全ゲート: 離地で停止(cfg.liftStop が true のときだけ)。実機センサ不安定時は config で無効化。
    //   next は現在の相をそのまま返す＝床に戻れば中断地点から再開できる。
    if (cfg.liftStop && s.lifted) {
        return { cmd: { kind: "stop", speed: 0 }, next: st };
    }

    // turn: 残り tick を1減らしながら旋回を続け、残り1tick で直進へ戻る。
    //   (yaw を使わず tick 数で測る＝ジャイロ不要。turnTicks を実機で約90度に調整)
    if (st.phase === "turn") {
        if (st.turnTicksLeft <= 1) {
            return {
                cmd: { kind: "forward", speed: cfg.driveSpeed },
                next: { phase: "drive", turnTicksLeft: 0 },
            }
        }
        return { 
            cmd: turnCmd, 
            next: { phase: "turn", turnTicksLeft: st.turnTicksLeft - 1 } 
        };
    }

    // drive: 壁に近づくまで直進。「正の距離で wallCm 未満」のときだけ旋回。
    //   distanceCm == 0 は「エコー無し＝前方に何も無い(遠い)」(firmware: pulseIn タイムアウトで 0)。
    //   0 を壁扱いすると開けた場所で誤旋回するので、0 は壁としない。
    const wallAhead = s.distanceCm > 0 && s.distanceCm < cfg.wallCm;
    if (wallAhead) {
        return {
            cmd: turnCmd,
            next: { phase: "turn", turnTicksLeft: cfg.turnTicks },
        };
    }
    
    return { cmd: { kind: "forward", speed: cfg.driveSpeed }, next: st };
}
