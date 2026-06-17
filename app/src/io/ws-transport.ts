// ws-transport.ts — Transport の WebSocket 実装。
// ブラウザ <-> Node中継(ws://localhost:8081) <-> ESP32 <-> UNO。
// SerialTransport と同じく buffer/frames/waiters で "{...}" を1フレームずつ取り出す。
import type { Transport } from "./transport";

export class WebSocketTransport implements Transport {
    private buffer = "";                            // 未完成の生テキスト
    private frames: string[] = [];                  // 完成済み在庫
    private waiters: ((f: string) => void)[] = [];  // 待ち要求

    private constructor(private ws: WebSocket) {
        ws.onmessage = (ev) => {
            this.buffer += typeof ev.data === "string" ? ev.data : "";
            this.extractFrames();
        };
    }

    /** ws://localhost:8081 へ接続。open 完了で解決。 */
    static async open(url: string): Promise<WebSocketTransport> {
        const ws = new WebSocket(url);
        await new Promise<void>((resolve, reject) => {
            ws.onopen = () => resolve();
            ws.onerror = () => reject(new Error("WebSocket 接続失敗: " + url + "(中継は起動してる?)"));
        });
        return new WebSocketTransport(ws);
    }

    private extractFrames(): void {
        const re = /\{[^}]*\}/g;
        let m: RegExpExecArray | null;
        let last = 0;
        while ((m = re.exec(this.buffer))) {
            const frame = m[0];
            const waiter = this.waiters.shift();
            if (waiter) waiter(frame);
            else this.frames.push(frame);
            last = re.lastIndex;
        }
        this.buffer = this.buffer.slice(last);
    }

    async write(data: string): Promise<void> {
        this.ws.send(data);
    }

    nextFrame(timeoutMs: number): Promise<string> {
        const ready = this.frames.shift();
        if (ready) return Promise.resolve(ready);
        return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
                const i = this.waiters.indexOf(wrapped);
                if (i >= 0) this.waiters.splice(i, 1);
                reject(new Error("ws timeout"));
            }, timeoutMs);
            const wrapped = (frame: string) => { clearTimeout(timer); resolve(frame); };
            this.waiters.push(wrapped);
        });
    }

    async close(): Promise<void> {
        this.ws.close();
    }
}
