// tools/ws-bridge.mjs — ブラウザ(WebSocket) <-> ESP32(TCP:100) の中継。
// ESP32純正firmwareの仕様に合わせる:
//   - 約1秒ごとに {Heartbeat} を送らないと ESP32 が切断する → こちらから送る
//   - ESP32 が送ってくる {Heartbeat} はセンサ応答ではないのでブラウザに流さない
//   - フレームは "{...}" 単位。完成したものだけ流す(分割到着に強く)
import net from "node:net";
import { WebSocketServer } from "ws";

const ESP32_HOST = "192.168.4.1";       // ESP32 AP の固定IP
const ESP32_PORT = 100;                 // 純正firmware の操作用TCPポート
const WS_PORT = 8081;                   // ブラウザがつなぐWS

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`[bridge] ws://localhost:${WS_PORT}  ->  tcp://${ESP32_HOST}:${ESP32_PORT}`);

wss.on("connection", (ws) => {
    console.log("[bridge] browser connected");
    const tcp = net.connect(ESP32_PORT, ESP32_HOST, () => console.log("[bridge] ESP32 connected"));
    
    // 1秒ごとにハートビート(無いと ESP32 が約4秒で切断する)
    const hb = setInterval(() => { try { tcp.write("{Heartbeat}"); } catch {} }, 1000);

    // ESP32 -> ブラウザ: "{...}" 単位で切り出し、{Heartbeat} を除いて転送
    let buf = "";
    tcp.on("data", (chunk) => {
        buf += chunk.toString("latin1");
        const re = /\{[^}]*\}/g;
        let m, last = 0;
        while ((m = re.exec(buf))) {
            const frame = m[0];
            if (frame !== "{Heartbeat}") ws.send(frame);
            last = re.lastIndex;
        }
        buf = buf.slice(last);
    });

    // ブラウザ -> ESP32: コマンド("{...}")をそのまま転送
    ws.on("message", (data) => { try { tcp.write(data.toString()); } catch {} });

    const cleanup = () => { clearInterval(hb); try { tcp.end(); } catch {} try { ws.close(); } catch {} };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
    tcp.on("close", () => { console.log("[bridge] ESP32 closed"); cleanup(); });
    tcp.on("error", (e) => { console.log("[bridge] tcp error:", e.message); cleanup(); });
});


