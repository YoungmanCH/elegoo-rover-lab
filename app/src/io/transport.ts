// import type { Command } from "../types";
// ※Chrome/Edge のみ・secure context(https/localhost)必須。open で Arduino が自動リセット。

/** 送受信のtransport:  。serial-robot はこれだけに依存(実機/ fake を差し替え可能)。 */
export interface Transport {
    write(data: string): Promise<void>;
    /** 次の "{...}" フレームを1つ返す。timeoutMs 超過で reject。 */
    nextFrame(timeoutMs: number): Promise<string>;

    // インスタンスで生成された接続を閉じる
    close(): Promise<void>;
}

const BAUD = 9600;  // ファーム(シリアル通信の速度) Serial.begin(9600)

/** Web Serial 実装。open() はユーザー操作(クリック)の中で呼ぶこと。 */
export class SerialTransport implements Transport {
    // 受信は非同期。
    private buffer = "";                            // フレームに切れていない生テキスト
    private frames: string[] = [];                  // まだ誰も取りに来ていないフレームの行列(=在庫)
    private waiters: ((f: string) => void)[] = [];  // 待機要求
    private encoder = new TextEncoder();            // 文字列→バイト列(送信用)
    private decoder = new TextDecoder();            // バイト列→文字列(受信用)

    private constructor(
        private port: SerialPort,
        private writer: WritableStreamDefaultWriter<Uint8Array>
    ) {}

    static async open(): Promise<SerialTransport> {
        const port = await navigator.serial.requestPort();      // ユーザー操作内で
        await port.open({ baudRate: BAUD });
        const writer = port.writable!.getWriter();
        const t = new SerialTransport(port, writer);
        void t._readLoop();                                      // 背景で受信し続ける
        await new Promise((r) => setTimeout(r, 2500));          // Arduino 自動リセット待ち
        
        // 起動ノイズ(chip_id や古い {21_0})を捨てて、最初の read を汚さない
        // ※ frames/buffer は private だが static メソッドは同一クラスなのでアクセス可
        t.frames.length = 0;
        t.buffer = "";
        
        return t;
    }

    private async _readLoop(): Promise<void> {
        const reader = this.port.readable!.getReader();
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                const text = this.decoder.decode(value);
                console.log("[RX]", JSON.stringify(text));
                this.buffer += text
                this._extractFrames();
            }
        // finally: tryの結果に関わらず必ず最後に実行される
        } finally {
            reader.releaseLock();
        }
    }

    /** buffer から完成した "{...}" を取り出し、待ち人がいれば渡す。 */
    private _extractFrames(): void {
        const re = /\{[^}]*\}/g;
        let m: RegExpExecArray | null;
        let last = 0;
        while ((m = re.exec(this.buffer))) {
            const frame = m[0];                                 // 例: "{21_45}"
            const waiter = this.waiters.shift();                // 先に待っている要求
            if (waiter) waiter(frame);
            else this.frames.push(frame);
            last = re.lastIndex;
        }
        this.buffer = this.buffer.slice(last);
    }

    async write(data: string): Promise<void> {
        console.log("[TX]", data);                // ←この1行を追加
        await this.writer.write(this.encoder.encode(data));
    }

    nextFrame(timeoutMs: number): Promise<string> {
        // すでに在庫(frame)があれば、待たずに即返す
        const ready = this.frames.shift();
        if (ready) return Promise.resolve(ready);

        // フレーム到着時に extractFrames が wrapped() を呼び、この Promise が解決する。
        return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
                // timeoutMs 経っても来なければ、自分を待ち行列から外して諦める(例外)
                const i = this.waiters.indexOf(wrapped);
                if (i >= 0) this.waiters.splice(i, 1);
                reject(new Error("serial timeout"));
            }, timeoutMs);
            const wrapped = (frame: string) => { clearTimeout(timer); resolve(frame); };
            this.waiters.push(wrapped);
        });
    }

    async close(): Promise<void> {
        this.writer.releaseLock();
        await this.port.close();
    }
}

