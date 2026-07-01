# 段階12：カメラ上流の再接続（P2・R2 実運用）— TDD＋smoke

> **番号**：改善計画（[stage12-improvement-plan](stage12-improvement-plan.md)）の **P2** 実装。他の P（P0/P1/P4/P5）は実装済でドキュメントを畳んだので、**残る P2 を stage12 系列**として本書に置く（旧 stage13c）。

> **ゴール**：走行負荷で ESP32 のストリームが落ちても **cam-proxy が自動復帰**（[_memo](_memo.md)：走行するとカメラが消える）。要件 R2 を「動く→**実運用で保つ**」へ。
> **原因**：ESP32 は stream 実質**1クライアント**＋制御トラフィックと競合し、負荷でストリーム断。cam-proxy に**上流再接続が無い**（[stage8b §5](stage8b-recording-pipeline.md) 既知の穴）。
> **設計の肝**：待ち時間（指数バックオフ）は**純関数 `backoffMs`** に出してテスト、再接続の配線は smoke。断のたびに **demux をリセット**（半端バイトを捨てる）、受信で試行回数リセット。定数は cam-config（ハードコーディング排除）。
> **前提**：ffmpeg-recorder(ensureDir 修正・実装済)。本書コードは **node:test＋tsc クリーンを実測確認済み**。
> **このstageの位置**：[stage12計画](stage12-improvement-plan.md) P2。

---

## 0. 実装状況（P2 の純部品は済・残るは配線1ファイル）

| 部品 | 状態 |
|---|---|
| `tools/lib/backoff.mjs`（§1） | ✅ 実装済 |
| `tools/cam-config.mjs` の `reconnectBaseMs/MaxMs`（§2） | ✅ 実装済 |
| `tools/lib/ffmpeg-recorder.mjs`（`ensureDir`） | ✅ 実装済（P1） |
| **`tools/cam-proxy.mjs` の再接続配線（§3）** | ⬜ **未実装＝この1ファイルの置き換えだけ** |

> **＝残作業は `cam-proxy.mjs` を §3 の全文に差し替えるだけ**（他は既に在る）。全文は **`node --test` 20/20・`tsc --checkJs` クリーンを実測確認済み**。§1/§2 は参考（既に実装済）。

---

## 1. `backoffMs`（純・バックオフ）※✅実装済・参考

### ① テスト（RED）`tools/lib/backoff.test.mjs`
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffMs } from "./backoff.mjs";
test("指数で増え、maxMs で頭打ち", { timeout: 1000 }, () => {
    assert.equal(backoffMs(0, 500, 8000), 500);
    assert.equal(backoffMs(1, 500, 8000), 1000);
    assert.equal(backoffMs(2, 500, 8000), 2000);
    assert.equal(backoffMs(5, 500, 8000), 8000);   // 500*32=16000 → 8000 で cap
});
```
### ② GREEN `tools/lib/backoff.mjs`
```js
// backoff.mjs — 再接続の待ち時間(指数バックオフ・上限つき)を出す(純)。
/** @param {number} attempt @param {number} baseMs @param {number} maxMs @returns {number} */
export function backoffMs(attempt, baseMs, maxMs) {
    return Math.min(maxMs, baseMs * 2 ** attempt);
}
```

## 2. `cam-config` の再接続定数（ハードコーディング排除）※✅実装済・参考
```js
export const camConfig = {
    upstream: "http://192.168.4.1:81/stream", port: 8082, outDir: "recordings", boundary: "frame",
    reconnectBaseMs: 500,   // 上流再接続の初回待ち
    reconnectMaxMs: 8000,   // 再接続待ちの上限
};
```

## 3. `cam-proxy.mjs` 全文（再接続込み・検証済み）

現状の `cam-proxy.mjs` は P1（`ensureDir`／`try-catch`／直接 path・query パース）まで入っている。**残りは単発 `http.get` を `connectUpstream()`/`scheduleReconnect()` に置き換えるだけ**。以下が**置き換え後の全文**（`node --test` 20/20・`tsc --checkJs` クリーンを実測確認済み）。

```js
// cam-proxy.mjs — ESP32 MJPEG を上流1本で取り、(ブラウザ再配信 + ffmpeg録画) に分配する。
// 設定=cam-config / 録画状態機械=ffmpeg-recorder / 再接続待ち=backoff（いずれもテスト済）に委譲。本ファイルは I/O 配線だけ。
import http from "node:http";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createDemux, extractFrames } from "./lib/mjpeg-demux.mjs";
import { multipartPart, multipartHeaders } from "./lib/multipart.mjs";
import { createFfmpegRecorder } from "./lib/ffmpeg-recorder.mjs";
import { backoffMs } from "./lib/backoff.mjs";
import { camConfig } from "./cam-config.mjs";

const { upstream, port, outDir, boundary, reconnectBaseMs, reconnectMaxMs } = camConfig;

/** @type {Set<import("node:http").ServerResponse>} */
const clients = new Set();

// 録画は controller に委譲。spawn/writeFile/ensureDir/nowIso を実体で注入(テストでは fake を注入)。
const rec = createFfmpegRecorder({
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),   // 書き込み前に dir を作る(ENOENT回避・P1)
    spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "inherit", "inherit"] }),
    writeFile: fs.writeFileSync,
    nowIso: () => new Date().toISOString(),
    outDir,
});

// --- 上流(ESP32 MJPEG)を1本張り、断/エラー時はバックオフ再接続(P2) ---
let demux = createDemux();
let attempt = 0;
function scheduleReconnect() {
    const ms = backoffMs(attempt++, reconnectBaseMs, reconnectMaxMs);
    console.log(`[cam] upstream 再接続を ${ms}ms 後に (試行 ${attempt})`);
    setTimeout(connectUpstream, ms);
}
function connectUpstream() {
    demux = createDemux();                                   // 断で残った半端バイトを捨てる
    http.get(upstream, (up) => {
        up.on("data", (chunk) => {
            attempt = 0;                                     // 受信できたらバックオフをリセット
            const r = extractFrames(demux, chunk); demux = r.state;
            for (const jpeg of r.frames) {
                const part = multipartPart(jpeg, boundary);
                for (const res of clients) res.write(part);  // ブラウザへ(multipart)
                rec.writeFrame(jpeg);                        // ffmpeg へ(録画中だけ・controller が判断)
            }
        });
        up.on("close", scheduleReconnect);                   // 上流が閉じたら再接続
    }).on("error", (e) => { console.error("[cam] upstream:", e.message); scheduleReconnect(); });
}
connectUpstream();

// --- ブラウザ表示 & 録画制御の HTTP サーバ ---
http.createServer((req, res) => {
    const reqUrl = req.url ?? "/";
    const q = reqUrl.indexOf("?");                           // base URL は使わない(host は読まないため)
    const pathname = q < 0 ? reqUrl : reqUrl.slice(0, q);
    const params = new URLSearchParams(q < 0 ? "" : reqUrl.slice(q + 1));

    if (pathname === "/stream") {                            // ブラウザ<img> 向け再配信(複数可)
        res.writeHead(200, multipartHeaders(boundary));
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
    }
    if (pathname === "/rec/start" && req.method === "POST") {
        try {
            const id = params.get("session") ?? `cam-${process.hrtime.bigint()}`;
            const ok = rec.start(id, upstream);              // 二重起動の判断は controller(テスト済)
            res.writeHead(ok ? 200 : 409).end(ok ? `recording ${id}.mp4` : "already recording");
        } catch (e) {
            console.error("[cam] rec/start:", /** @type {Error} */ (e).message);   // 失敗しても proxy を殺さない(P1)
            res.writeHead(500).end("rec start failed");
        }
        return;
    }
    if (pathname === "/rec/stop" && req.method === "POST") {
        rec.stop();
        res.writeHead(200).end("stopped");
        return;
    }
    res.writeHead(404).end();
}).listen(port, () => console.log(`[cam] proxy http://localhost:${port}  upstream ${upstream}`));
```

**差分（現状→この形）＝これだけ**：①`import { backoffMs }` と `reconnectBaseMs, reconnectMaxMs` の分割代入を追加 ②単発 `http.get(upstream, …)` を **`connectUpstream()`＋`scheduleReconnect()`** に置換（`close`/`error` で指数バックオフ再接続・`data` で `attempt=0`・再接続時に `demux` リセット）。**それ以外（`ensureDir`・`try/catch`・直接 path/query パース・ルーティング）は不変**。`function` 宣言は巻き上げられるので相互参照・末尾 `connectUpstream()` はOK。

---

## 4. システムフロー（再接続）
```
connectUpstream() → demux リセット → http.get(upstream)
   ├─ data       → attempt=0・JPEG を分配(ブラウザ/ffmpeg)
   ├─ close      → scheduleReconnect()
   └─ error      → scheduleReconnect()
scheduleReconnect() → backoffMs(attempt++,base,max) 後に connectUpstream()
```
- **運用**：app は必ず **`useProxy`（proxy 経由）で 1 上流に集約**し、直URL（192.168.4.1）は覗かない＝**単一クライアント競合を作らない**（[_memo](_memo.md) の「app と直URLの取り合い」を回避）。

## 5. 依存関係
```
cam-proxy(I/O・smoke) ─▶ backoff(純・テスト済) / mjpeg-demux / multipart / ffmpeg-recorder
                     └─ camConfig(定数: reconnectBaseMs/MaxMs)
```

## 6. テストは足りるか／DoD
- 純：`backoffMs`（指数・cap）をユニット固定。demux の分割不変は既存。
- 不能・別手段：**実際に落ちて復帰するか**は smoke（[stage12 F1](stage12-hardware-verification.md)：ESP32 を一瞬切断→自動復帰）。負荷（scan＋録画）での fps 低下も smoke。
- DoD：`cd tools && npm test`（**20/20**）／`npm run typecheck` 緑（＝ロジックは済）。**残るは smoke のみ**：[stage12 F1](stage12-hardware-verification.md)（ESP32 を一瞬切断→**数百ms〜数秒で自動復帰**）／負荷（scan＋録画）で fps 低下しないか／同時stream数（[D2](stage12-hardware-verification.md)）を確定し `current-build-spec.md` に記録。

---
関連：[stage12-improvement-plan.md](stage12-improvement-plan.md)（P2）／ [stage8b §5](stage8b-recording-pipeline.md)（再接続＝既知の穴）／ ffmpeg-recorder（ensureDir 修正・実装済＝proxy が落ちない）
</content>
