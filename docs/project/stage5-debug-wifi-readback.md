# 段階5 デバッグ：WiFiでセンサ応答が戻らない問題

> **何を解くか**：ブラウザ→WiFi→ロボットで、距離センサの応答が戻らず `ws timeout` で自走できない。原因の場所を**1回の実機ログで確定**させる。
> **位置づけ**：デバッグの仮説と手順。**ソース（特にファーム）はまだ編集しない**。ここで犯人を特定してから、最小の修正を別途行う。
> 参照：[stage5-wireless-camera.md](stage5-wireless-camera.md) ／ [stage5-connection-guard.md](stage5-connection-guard.md) ／ [machine-reference.md](../reference/machine-reference.md)

---

## 1. 事実と症状

**わかっていること（確定）**
- UNO（`arduino/`）はUSB接続で距離も離地も全部返す＝<!-- * -->*正常**（実証済み）。
- UNOの**ハードUARTは1本**（D0/D1）で、**USB(CH340)とESP32(Serial2)が同じ線を共有**。
  → UNOは**USBでもWiFiでも同じバイトを同じ線に出す**。WiFiのときだけ「返さない」は物理的に起きない。
- カメラ（WiFi/ESP32/IP）は出る。コマンド送信（駆動）も届く。

**症状**
- ブラウザは距離応答を待ち続け、`nextFrame` が 1500ms で `ws timeout`。
- 中継ログで過去に `ECONNRESET` / `ESP32 closed`、`browser connected` が2回（二重接続）も観測。

---

## 2. 確定事項：ESP32は「双方向」（コード根拠）

ESP32純正ファーム `ESP32_CameraServer_AP_20220120.ino` のブリッジ本体。**UNO→ブラウザの転送は無条件**で存在する：

```cpp
if (Serial2.available())        // UNO → ESP32
{
  char c = Serial2.read();
  sendBuff += c;
  if (c == '}')                 // フレーム終端で
  {
    client.print(sendBuff);     // ★ブラウザへ転送(無条件)
    Serial.print(sendBuff);     //  隣の行でESP32のUSBにもデバッグ出力
    sendBuff = "";
  }
}
```

- コマンドの行きも `Serial2.print(readBuff)` で素通し。`{Heartbeat}` だけ別扱い（Serial2に流さず生存カウントをリセット）。
- ESP32は1秒ごとに `client.print("{Heartbeat}")`。**クライアントが約3秒 `{Heartbeat}` を送らないと `break`（切断）**し、切断時は `{"N":100}`（停止）をUNOへ送る。

→ **結論：「ESP32が一方通行で握り潰す」は誤り。** よって **`arduino/`（UNO）を直しても無関係**だし、ESP32ファームも“転送していない”わけではない。**犯人はもっと手前か、別の落ち方**。

---

## 3. 応答はどこで消えるか（仮説・確度順）

| # | 仮説 | WiFi特有か | 確度 |
|---|---|---|---|
| H1 | UNOのエコー等で**別フレームが先に届き**、read() が取り違える／対応ズレ | △ | 中 |
| H2 | **接続が落ちている**（二重接続・Heartbeat切れ・RobotSession絡み）→ 読取り前後で切断 | ○ | 中 |
| H3 | WiFi送信ストールで**ESP32のSerial2 RXがオーバーフロー**し、応答バイトを取りこぼし→`}`来ず未転送 | ◎ | 中 |
| H4 | 中継/transport の**フレーム結合・分割**で取り出し失敗 | △ | 低 |
| H5 | そもそも**コマンドがUNOに届いていない**（①が未検証なら） | △ | 低 |
| H6 | **タイムアウト1500msが短い**（WiFi往復＋Heartbeatジッタで間に合わない） | ○ | 低〜中 |

どれも **`arduino/` では直らない**（UART共有＋ESP32は転送済みのため）。

---

## 4. 決定打：中継の「生ログ」で一発切り分け

`tools/ws-bridge.mjs` に**一時的なログ**を足し、ESP32から来る**生バイト（フィルタ前）**と、ブラウザへ送ったフレーム、ブラウザから来たコマンドを全部見える化する。これで「ESP32が `{21_<n>}` を実際に吐いているか」が確定する。

### 提案する変更（一時デバッグ。確認後に戻す）

> **前提**：`tcp` と `ws` は**新しく宣言しない**。下記は `wss.on("connection", (ws) => { … })` の**中**にある
> 既存の `tcp.on("data")`（現25行目あたり）と `ws.on("message")`（現38行目あたり）を**置き換える**だけ。
> `ws` はそのコールバック引数、`tcp` は同ブロック冒頭の `const tcp = net.connect(...)`（現18行目）で既に存在する。
> 文脈を示すと↓（`wss.on(...)`〜`const tcp`〜`let buf` は**既存・無変更**、`★`の console.log だけ追加）。

```js
wss.on("connection", (ws) => {                 // 既存：ws はここの引数
    console.log("[bridge] browser connected"); // 既存
    const tcp = net.connect(ESP32_PORT, ESP32_HOST, () => console.log("[bridge] ESP32 connected")); // 既存：tcp はここ
    const hb = setInterval(() => { try { tcp.write("{Heartbeat}"); } catch {} }, 1000);             // 既存

    // ↓↓↓ ここから既存の tcp.on("data") を、この内容に置き換える ↓↓↓
    let buf = "";
    tcp.on("data", (chunk) => {
        const raw = chunk.toString("latin1");
        console.log("[esp32→raw]", JSON.stringify(raw));        // ★① 生バイト(フィルタ前)
        buf += raw;
        const re = /\{[^}]*\}/g;
        let m, last = 0;
        while ((m = re.exec(buf))) {
            const frame = m[0];
            if (frame !== "{Heartbeat}") { console.log("[esp32→ws]", frame); ws.send(frame); }  // ★② 転送した非HB
            last = re.lastIndex;
        }
        buf = buf.slice(last);
    });

    // ↓↓↓ ここで既存の ws.on("message") を、この内容に置き換える ↓↓↓
    ws.on("message", (data) => {
        const s = data.toString();
        console.log("[ws→esp32]", s);                           // ★③ ブラウザ→ESP32 のコマンド
        try { tcp.write(s); } catch {}
    });

    // …以降の cleanup / ws.on("close") / tcp.on("close") 等は既存のまま…
});
```

### 実機での取り方（交絡を消す）
1. **USBは抜く**（UNOへのUSBシリアルを開かない。電源は電池）。
2. 中継は**1個だけ**起動。ブラウザは**1タブ・WiFi接続は1回だけ**（二重接続を避ける）。
3. WiFi接続 → 「開始」で自走を試す → コンソールを5〜10秒キャプチャ。
4. 既存の `[bridge] browser connected` / `ESP32 connected` / `ESP32 closed` の出方も一緒に見る。

---

## 5. 判定表（ログ → 結論 → 次の一手）

| ログで見えるもの | 結論 | 次の一手 |
|---|---|---|
| `[ws→esp32] {…N…21…}` が出て、`[esp32→raw]` に `{21_<n>}` が出る | **UNO応答到達・ESP32転送OK**。犯人はブラウザ/transport側 | §6でWebSocketTransportを計測（H1/H4/H6） |
| `[ws→esp32]` は出るが `[esp32→raw]` は `{Heartbeat}` だけ | **ESP32がセンサ応答を出していない** | H3(オーバーフロー) or H5(コマンド未達)。ESP32のUSBデバッグSerialで `Serial.print(sendBuff)` が出るか確認して二分 |
| 読取り中に `ESP32 closed` / `ECONNRESET` | **接続が落ちている** | H2：接続ライフサイクル/RobotSession/Heartbeatを点検 |
| `[esp32→ws] {21_<n>}` は出るのにブラウザが timeout | **転送済みなのにブラウザが取れない** | H6：`nextFrame` の 1500ms を 3000ms に上げて再試験＋§6 |

---

## 6. 二段目（必要なら）：ブラウザ側 transport の計測

§5で「ブラウザ/transport側」に絞れたら、`app/src/io/ws-transport.ts` の `extractFrames()` に
「取り出したフレーム」と「waiterに渡したか在庫に積んだか」を一時ログする。さらに `serial-robot` の
read() が**どのフレームをどのクエリの応答として対応づけたか**を見れば、H1（取り違え）かH6（時間切れ）が確定する。

---

## 7. 触ってよい / ダメ（重要）

- **OK（一時デバッグ）**：`tools/ws-bridge.mjs` と `app/src/io/ws-transport.ts` への **console.log 追加のみ**。確認後に戻す。
- **やらない**：UNOファーム（`arduino/`）の編集 ＝ この問題には無関係（§1・§2）。
- **やらない（今は）**：ESP32ファームの書き換え ＝ 転送は既にしている（§2）。犯人確定までフラッシュしない。
