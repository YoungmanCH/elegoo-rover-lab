# 段階5：無線操作（WiFi）＋カメラ映像 — 厳密手順

> **ゴール**：USB を外し、車を**バッテリ駆動で無線操作**する。ついでに**カメラ映像**もブラウザに表示。
> **前提**：ESP32-CAM は組付け済み・**純正firmware（`ESP32_CameraServer_AP_20220120`）が焼かれている**。→ **ESP32 は触らない（再書き込み不要）**。
> **設計の肝**：`Transport` インターフェースのおかげで、ブラウザ側は **`WebSocketTransport` を1個足して差し替えるだけ**。brain / runner / protocol / serial-robot は**無変更**。

---

## 0. 確定した「ESP32純正firmwareの仕様」（ソースで裏取り済み）

出典＝`02 Main Code & APP/04 Code of Carmer (ESP32)/…/ESP32_CameraServer_AP_20220120/`。

| 項目 | 値 | 出典 |
|---|---|---|
| WiFi | **AP モード**（車がアクセスポイントを立てる） | `WiFi.softAP(mac_default, password, 9)` |
| SSID | **`ELEGOO-` + MAC**（例 `ELEGOO-XXXXYYYYYYYY`） | `char *ssid = "ELEGOO-"` |
| パスワード | **無し（オープン）** | `char *password = ""` |
| AP の IP | **`192.168.4.1`** | ESP32 softAP 既定 |
| 操作の口 | **生TCP・ポート `100`** | `WiFiServer server(100)` |
| ESP32↔UNO | **Serial2 9600bps**（RXD2=33,TXD2=4） | `Serial2.begin(9600, SERIAL_8N1, RXD2, TXD2)` |
| 橋渡し | TCPで来た `{...}` を **UNOへ転送**、UNOの `{...}` を **TCPへ返す**（双方向・透過） | `Serial2.print(readBuff)` / `client.print(sendBuff)` |
| **ハートビート** | **クライアントが約1秒ごとに `{Heartbeat}` を送らないと、約4秒で切断**。`{Heartbeat}` はUNOへ転送されない | `readBuff.equals("{Heartbeat}")` / `Heartbeat_count > 3 → break` |
| 自動停止 | クライアント切断・接続数0 で UNO に **`{"N":100}`（停止）** を送る | `Serial2.print("{\"N\":100}")` |
| カメラ | **MJPEG**。index=`http://192.168.4.1/`（80）、**stream=`http://192.168.4.1:81/stream`** | `config.server_port += 1` / `stream_uri.uri = "/stream"` |

### ここから導かれる設計上の必須事項
1. **ブラウザは生TCPを喋れない** → 間に **Node の WS↔TCP 中継**を1個挟む（下記）。
2. **中継が約1秒ごとに `{Heartbeat}` を送る**（これが無いと勝手に切れる）。
3. 中継は ESP32 から来る `{Heartbeat}` を**ブラウザに流さない**（センサ応答ではない）。
4. 切断＝自動停止が効くので、**ブラウザ/中継を閉じれば車は止まる**（安全）。
5. **UNO のシリアル(0/1番ピン)は USB と ESP32 で共有**。無線運用時は **USB を抜く**（電源はバッテリ）。

---

## 1. データの流れ（全体像）

```
[ブラウザ app  localhost:5173]
   │  ├─ WS ──> [Node中継  localhost:8081] ──TCP:100──> WiFi ──> [ESP32] ──Serial2(9600)──> [UNO firmware]
   │  │            ↑ ~40行・ハートビート/フィルタ担当          ↑ 純正firmwareが既に対応(無改造)
   │  └─ <img src="http://192.168.4.1:81/stream">  ← カメラMJPEG(ESP32から直接)
   └─ ノートPCは WiFi「ELEGOO-xxxx」(オープン)に接続。localhost(Vite/中継)はループバックで生きる。
```

---

## 2. 手順A：車をWiFiにする（コード不要）
1. **USB を抜く**。車は**満充電のバッテリ**で電源ON（ESP32 と UNO が起動）。
2. ノートPCの WiFi 一覧から **`ELEGOO-xxxx`**（オープン）に接続。
3. ブラウザで **`http://192.168.4.1/`** を開く → ELEGOO のカメラ画面が出れば ESP32 は生きている。
   - 映像だけ確認するなら **`http://192.168.4.1:81/stream`**。
   - ※この間 PC はインターネット無し。localhost の開発サーバ/中継は問題なく動く。

---

## 3. 手順B：Node の WS↔TCP 中継（新規ファイル2つ）

### `tools/ws-bridge.mjs`
```js
// tools/ws-bridge.mjs — ブラウザ(WebSocket) <-> ESP32(TCP:100) の中継。
// ESP32純正firmwareの仕様に合わせる:
//   - 約1秒ごとに {Heartbeat} を送らないと ESP32 が切断する → こちらから送る
//   - ESP32 が送ってくる {Heartbeat} はセンサ応答ではないのでブラウザに流さない
//   - フレームは "{...}" 単位。完成したものだけ流す(分割到着に強く)
import net from "node:net";
import { WebSocketServer } from "ws";

const ESP32_HOST = "192.168.4.1";   // ESP32 AP の固定IP
const ESP32_PORT = 100;             // 純正firmware の操作用TCPポート
const WS_PORT = 8081;               // ブラウザがつなぐWS

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
```

### `tools/package.json`
```json
{
  "name": "ws-bridge",
  "private": true,
  "type": "module",
  "dependencies": { "ws": "^8.18.0" }
}
```

### 起動
```bash
cd tools
npm install        # ws を入れる
node ws-bridge.mjs # "[bridge] ws://localhost:8081 -> tcp://192.168.4.1:100"
```
> PC が `ELEGOO-xxxx` に接続済みでないと TCP がつながらない（先に手順A）。

---

## 4. 手順C：ブラウザ側 `WebSocketTransport`（新規1ファイル）

`SerialTransport` と**同じ契約**（write/nextFrame/close）。USB と違い**Arduino自動リセットは無い**ので待ち時間も不要。

### `app/src/io/ws-transport.ts`
```ts
// ws-transport.ts — Transport の WebSocket 実装。
// ブラウザ <-> Node中継(ws://localhost:8081) <-> ESP32 <-> UNO。
// SerialTransport と同じく buffer/frames/waiters で "{...}" を1フレームずつ取り出す。
import type { Transport } from "./transport";

export class WebSocketTransport implements Transport {
  private buffer = "";                              // 未完成の生テキスト
  private frames: string[] = [];                    // 完成済み在庫
  private waiters: ((f: string) => void)[] = [];    // 待ち要求

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
```

> `SerialRobot` は `Transport` にしか依存しないので、`new SerialRobot(wsTransport)` でそのまま動く（名前は履歴的に Serial だが中身は Transport 依存。気になるなら `RobotOverTransport` 等に改名可。任意）。

---

## 5. 手順D：`main.ts` と `index.html` に WiFi接続＋カメラを追加

`main.ts` は段階4（[stage4-wall-and-estop.md](stage4-wall-and-estop.md)）の状態が前提。**realRobot / realRunner / emergencyStop は既にある**ので、**追記だけ**。

### `app/src/main.ts`（追記）
```ts
// 先頭の import に追加
import { WebSocketTransport } from "./io/ws-transport";

// 定数(ファイル上部のどこか)
const WS_URL = "ws://localhost:8081";
const CAM_URL = "http://192.168.4.1:81/stream";

// WiFi接続ボタン(USBの #connect と同じ構造。Transport だけ WS に差し替え)
document.querySelector("#connect-wifi")!.addEventListener("click", async () => {
  const tx = await WebSocketTransport.open(WS_URL);
  realRobot = new SerialRobot(tx);                 // ★同じ SerialRobot(Transport 依存)
  realRunner = createRunner(realRobot, defaultConfig, initialState, (state, sensors, cmd) => {
    console.log(`[tick] dist=${sensors.distanceCm}cm phase=${state.phase} cmd=${cmd.kind}`);
  });
  const cam = document.querySelector<HTMLImageElement>("#cam");
  if (cam) cam.src = CAM_URL;                       // カメラ映像を表示
  console.log("WiFi接続OK。『開始』で自走、『停止』/Esc/Spaceで停止。");
});
```
> `#start`（`(realRunner ?? simRunner).start()`）と `#stop`/Esc/Space（`emergencyStop`）は段階4のまま使える。停止は WS 経由で N=4 が飛ぶ＋ブラウザ/中継を閉じれば ESP32 が `{"N":100}` で自動停止。

### `app/index.html`（ボタンとカメラを追加）
```html
<div>
  <button id="start">開始</button>
  <button id="stop">停止</button>
  <button id="connect">実機接続（USB）</button>
  <button id="connect-wifi">WiFi接続</button>
</div>
<img id="cam" alt="camera" width="320" style="border:1px solid #ccc; display:block; margin-top:8px" />
```

---

## 6. 通し手順（本番フロー）
1. **USBを抜く** → 車をバッテリで電源ON（満充電）。
2. PCの WiFi を **`ELEGOO-xxxx`** に接続。
3. `http://192.168.4.1/` でカメラが映るか確認（ESP32生存チェック）。
4. ターミナル①：`cd tools && npm install && node ws-bridge.mjs` → 待受ログ。
5. ターミナル②：`cd app && npm run dev` → Chrome で `http://localhost:5173/`。F12でConsole。
6. **「WiFi接続」**をクリック → "WiFi接続OK"＋カメラ表示。中継ログに "ESP32 connected"。
7. **「開始」** → 車が**無線で自走**（`[tick] dist=..` も流れる）。
8. **「停止」/Esc/Space** で止まる。ブラウザを閉じても ESP32 の自動停止で止まる。

---

## 7. つまずきポイント（厳密）
- **中継を先に起動**＆**先に `ELEGOO-xxxx` に接続**。順序を逆にすると TCP 接続失敗（中継ログに `tcp error`）。
- **USBは抜く**。UNOのUARTはUSBとESP32で共有。両方つなぐと文字化け。
- **ハートビート必須**：中継が `{Heartbeat}` を毎秒送る。中継を使わず直叩きすると約4秒で切断される。
- **混在コンテンツ**：アプリは `http://localhost`（非https）なので `http://192.168.4.1:81/stream` を読める。**httpsで配信すると映像はブロックされる**ので、デモは localhost(http) のままで。
- **タイムアウト**：`TIMEOUT_MS=1500` のままでOK（AP内は低遅延）。`{Heartbeat}` は中継で除去済みなのでブラウザには来ない。
- **カメラのポート**：index は 80、**stream は 81**（firmwareが `server_port += 1`）。URLは `http://192.168.4.1:81/stream`。
- **電波の安全弁**：WiFiが切れる/ブラウザを閉じると ESP32 が UNO に `{"N":100}` を送って**自動停止**。暴走時はブラウザを閉じるのも有効。

---

## 8. 補足：Node中継を無くしたい場合（任意・本番後）
ESP32 を「WebSocketサーバ」firmware に焼き替えれば中継不要でブラウザ直結にできる（純ブラウザ・サーバレス）。ただし ESP32 の再書き込み＋カメラ統合が要る。**今回は純正firmware＋Node中継が最短で堅い**ため、これは将来案。

---
関連：[stage4-wall-and-estop.md](stage4-wall-and-estop.md)（実機自走・停止・壁検知）／ [stage3-code-part2.md](stage3-code-part2.md)（Transport/SerialTransport）／ [code-design.md](code-design.md) §5,§6.1
