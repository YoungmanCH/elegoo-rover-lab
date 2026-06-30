# 段階8b：録画パイプライン（プロキシ＋ffmpeg・型付き）— TDD＋smoke

> **ゴール**：[8a](stage8a-mjpeg-demux.md) の `extractFrames` を核に、**上流1本→(ブラウザ再配信＋ffmpeg録画) に分配するプロキシ** `tools/cam-proxy.mjs` を組む。これで **(a) ESP32への上流接続が1本（同時接続問題が消える）(b) localhost 経由で CORS 汚染が解ける (c) ライブ表示は維持** を同時に取る。
> **設計の肝**：判断と整形は全部**純関数＋JSDoc型**で TDD（ffmpeg引数・multipartパート・出力パス/サイドカー）。プロキシは「純部品を繋ぐ薄いグルー」にして smoke。**型を書くと配線の穴（null/undefined/二重起動）が露見**する＝後述。
> **前提**：[8a](stage8a-mjpeg-demux.md)（tools の型付け環境込み）。出力名は **stage7 の `sessionId` を共有**（動画と軌跡が対になる→[8c](stage8c-browser-and-sync.md)）。stage6 はカメラに型影響なし（負荷は[8c §8](stage8c-browser-and-sync.md)）。
> **このstageの位置**：[8a](stage8a-mjpeg-demux.md) → 8b(本書) → [8c](stage8c-browser-and-sync.md)。

---

## 0. 着手前の実機検証（コードより先・10分）

方式を決めるのは「ESP32 の同時 stream 数」（[architecture §7](../reference/design-trajectory-recording-architecture.md)）。**コードより先に実機で2つ確認**：
1. **録れるか**：`ffmpeg -i http://192.168.4.1:81/stream -c copy /tmp/cam.mkv` 数十秒 → 再生可・fps・解像度。
2. **同時数**：stream を**2タブで同時に開く** → 両方映れば「2以上OK」、2つ目で1つ目が落ちれば「1のみ」。

→ **2以上OK**なら ffmpeg 直録り＋ブラウザ表示そのままで足り、プロキシは任意。**1のみ**ならプロキシ必須。どちらでも以下の純部品は共通。

---

## 1. データの流れ（プロキシの分配）

```
[ESP32 :81/stream]──(上流1本)──> cam-proxy.mjs
   multipart/x-mixed-replace        │  extractFrames(8a) で JPEG を1枚ずつ
                                     ├─ multipartPart → :8082/stream（ブラウザ<img>・CORS可・複数可）
                                     └─ 生JPEG → ffmpeg stdin → recordings/<sessionId>.mp4
                                                                 ＋ recordings/<sessionId>.json(サイドカー)
   制御: POST :8082/rec/start?session=<id> / POST :8082/rec/stop
```
- **ブラウザには multipart で包んで**再送（`<img>` が表示）。**ffmpeg には生 JPEG を連結**で（`-f mjpeg`）。同一フレームを2系統へ。
- 録画名は **`<sessionId>.mp4`**＝stage7 の軌跡ログ `videoFile` と一致（[8c](stage8c-browser-and-sync.md) 同期）。

---

## 2. 純部品を TDD（JSDoc 型付き）

### 2.1 `tools/lib/ffmpeg-args.mjs`
**① テスト（RED）** `tools/lib/ffmpeg-args.test.mjs`
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { ffmpegArgs } from "./ffmpeg-args.mjs";

test("既定引数・outPath は末尾", () => {
    const a = ffmpegArgs("recordings/s1.mp4");
    assert.deepEqual(a.slice(0, 4), ["-f", "mjpeg", "-use_wallclock_as_timestamps", "1"]);
    assert.equal(a[a.length - 1], "recordings/s1.mp4");
    assert.ok(a.includes("libx264"));
});
test("codec/pixFmt を上書き(ハードコーディングしない)", () => {
    const a = ffmpegArgs("o.mp4", { codec: "mjpeg", pixFmt: "yuvj420p" });
    assert.ok(a.includes("mjpeg") && a.includes("yuvj420p") && !a.includes("libx264"));
});
```
**② GREEN** `tools/lib/ffmpeg-args.mjs`
```js
// ffmpeg-args.mjs — 連結JPEG(stdin)→mp4 録画の ffmpeg 引数を組む(純)。値は呼び元から(ハードコーディングしない)。

/**
 * @typedef {object} FfmpegOpts
 * @property {string} [codec]  映像コーデック(既定 libx264)。
 * @property {string} [pixFmt] ピクセルフォーマット(既定 yuv420p)。
 */

/**
 * @param {string} outPath 出力 mp4 のパス。
 * @param {FfmpegOpts} [opts]
 * @returns {string[]} ffmpeg の引数列。
 */
export function ffmpegArgs(outPath, opts = {}) {
    const { codec = "libx264", pixFmt = "yuv420p" } = opts;
    return [
        "-f", "mjpeg",
        "-use_wallclock_as_timestamps", "1",   // 可変fpsでも実時間どおりの再生速度に
        "-i", "pipe:0",
        "-c:v", codec,
        "-pix_fmt", pixFmt,
        "-movflags", "+faststart",
        "-y", outPath,
    ];
}
```

### 2.2 `tools/lib/multipart.mjs`
**① テスト（RED）** `tools/lib/multipart.test.mjs`
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { multipartHeaders, multipartPart } from "./multipart.mjs";

test("headers: boundary と CORS", () => {
    const h = multipartHeaders("frame");
    assert.equal(h["Content-Type"], "multipart/x-mixed-replace; boundary=frame");
    assert.equal(h["Access-Control-Allow-Origin"], "*");
});
test("part: 境界 + Content-Length=長さ + 末尾CRLF", () => {
    const part = multipartPart(Buffer.from([1, 2, 3]), "frame").toString("latin1");
    assert.ok(part.startsWith("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 3\r\n\r\n"));
    assert.ok(part.endsWith("\r\n"));
});
```
**② GREEN** `tools/lib/multipart.mjs`
```js
// multipart.mjs — JPEG を multipart/x-mixed-replace の1パートに包む(純)。ブラウザ<img>へ再配信用。

/**
 * @param {string} boundary
 * @returns {Record<string, string>} multipart 応答ヘッダ。
 */
export function multipartHeaders(boundary) {
    return {
        "Content-Type": `multipart/x-mixed-replace; boundary=${boundary}`,
        "Access-Control-Allow-Origin": "*",   // localhost 経由で <img>/canvas の CORS 汚染を防ぐ
        "Cache-Control": "no-cache",
    };
}

/**
 * @param {Buffer} jpeg
 * @param {string} boundary
 * @returns {Buffer} 1パート(ヘッダ+JPEG+CRLF)。
 */
export function multipartPart(jpeg, boundary) {
    const head = Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
    return Buffer.concat([head, jpeg, Buffer.from("\r\n")]);
}
```

### 2.3 `tools/lib/recording-paths.mjs`（stage7 同期）
**① テスト（RED）** `tools/lib/recording-paths.test.mjs`
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { videoFilename, sidecar } from "./recording-paths.mjs";

test("videoFilename: sessionId.mp4", () => {
    assert.equal(videoFilename("2026-06-30T10-00-00-000Z"), "2026-06-30T10-00-00-000Z.mp4");
});
test("sidecar: 軌跡と同じ sessionId/videoFile", () => {
    const s = sidecar("s1", "2026-06-30T10:00:00.000Z", "http://192.168.4.1:81/stream");
    assert.equal(s.videoFile, "s1.mp4");
    assert.equal(s.startedAtIso, "2026-06-30T10:00:00.000Z");
    assert.equal(s.upstream, "http://192.168.4.1:81/stream");
});
```
**② GREEN** `tools/lib/recording-paths.mjs`
```js
// recording-paths.mjs — 録画の出力名とサイドカー(純)。sessionId は stage7 と共有=動画と軌跡が対になる。

/**
 * @param {string} sessionId
 * @returns {string} 録画ファイル名。
 */
export function videoFilename(sessionId) {
    return `${sessionId}.mp4`;
}

/** @typedef {{ sessionId: string, startedAtIso: string, upstream: string, videoFile: string }} Sidecar */

/**
 * @param {string} sessionId
 * @param {string} startedAtIso
 * @param {string} upstream
 * @returns {Sidecar} 軌跡ログと突き合わせる同期メタ。
 */
export function sidecar(sessionId, startedAtIso, upstream) {
    return { sessionId, startedAtIso, upstream, videoFile: videoFilename(sessionId) };
}
```

> ここまで `npm test`＝**node:test で 8a+8b の純部品 15 tests pass**、`npm run typecheck`＝**型エラー無し**（実測済み）。

### 2.4 `tools/lib/ffmpeg-recorder.mjs`（録画の状態機械＝注入してテスト）

録画の **start/stop・二重起動ガード・録画中だけ流す** は分岐ロジック＝バグの巣（実際 409 ガードは型に気づかされて足したもので、テストで守られていなかった）。`recorder.ts`（stage7d）が `now`/`poseSource` を注入したのと同じ手で、`spawn`/`writeFile`/`nowIso` を**注入**して**実プロセス無しでテスト**する。これで「全部 smoke」から「**状態機械はユニット・生I/Oだけ smoke**」へ。

**① テスト（RED）** `tools/lib/ffmpeg-recorder.test.mjs`（fake spawn/fs/clock）
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFfmpegRecorder } from "./ffmpeg-recorder.mjs";

function setup() {
    const log = { spawns: [], files: [], ended: 0, written: [] };
    const fakeProc = { stdin: { write: (b) => log.written.push(b), end: () => { log.ended++; } } };
    const deps = {
        spawn: (cmd, args) => { log.spawns.push({ cmd, args }); return fakeProc; },
        writeFile: (p, d) => log.files.push({ p, d }),
        nowIso: () => "2026-06-30T10:00:00.000Z",
        outDir: "rec",
    };
    return { log, c: createFfmpegRecorder(deps) };
}

test("start: ffmpeg を1回 spawn しサイドカーを書く", { timeout: 1000 }, () => {
    const { log, c } = setup();
    assert.equal(c.start("s1", "http://up"), true);
    assert.equal(c.isRecording(), true);
    assert.equal(log.spawns.length, 1);
    assert.ok(log.spawns[0].args.at(-1).endsWith("rec/s1.mp4"));   // 出力先が <id>.mp4
    assert.ok(log.files[0].p.endsWith("rec/s1.json"));             // サイドカーを書く
    assert.match(log.files[0].d, /"videoFile":"s1\.mp4"/);         // 軌跡と対になる videoFile
});
test("二重 start を弾く(旧プロセスをリークしない)", { timeout: 1000 }, () => {
    const { log, c } = setup();
    c.start("s1", "up");
    assert.equal(c.start("s2", "up"), false);     // 2回目は拒否
    assert.equal(log.spawns.length, 1);           // spawn は1回だけ
});
test("writeFrame: 録画中だけ stdin に流す", { timeout: 1000 }, () => {
    const { log, c } = setup();
    c.writeFrame(Buffer.from([1]));               // 録画前は無視(no-op)
    assert.equal(log.written.length, 0);
    c.start("s1", "up");
    c.writeFrame(Buffer.from([2]));
    assert.equal(log.written.length, 1);
});
test("stop: stdin を閉じ idle に戻す / idle stop は安全", { timeout: 1000 }, () => {
    const { log, c } = setup();
    c.start("s1", "up");
    c.stop();
    assert.equal(log.ended, 1);
    assert.equal(c.isRecording(), false);
    c.stop();                                     // idle で呼んでも例外なし
    assert.equal(log.ended, 1);                   // 二重に end しない
});
```

**② GREEN** `tools/lib/ffmpeg-recorder.mjs`
```js
// ffmpeg-recorder.mjs — 録画の開始/停止の状態(状態機械)。spawn/fs/clock を注入＝実プロセス無しでテスト可。
import { ffmpegArgs } from "./ffmpeg-args.mjs";
import { videoFilename, sidecar } from "./recording-paths.mjs";

/**
 * @typedef {object} RecProc 録画プロセス(stdin に JPEG を流す)。
 * @property {{ write(b: Uint8Array): void, end(): void } | null} stdin
 */
/**
 * @typedef {object} RecControllerDeps
 * @property {(cmd: string, args: string[]) => RecProc} spawn  ffmpeg を起動(注入＝テストで fake)。
 * @property {(path: string, data: string) => void} writeFile  サイドカー書き出し(注入)。
 * @property {() => string} nowIso  ISO時刻(注入＝Date を内部で呼ばない)。
 * @property {string} outDir  出力ディレクトリ。
 */

/** @param {RecControllerDeps} deps */
export function createFfmpegRecorder(deps) {
    /** @type {RecProc | null} */
    let proc = null;
    return {
        isRecording: () => proc !== null,
        /**
         * @param {string} sessionId
         * @param {string} upstream
         * @returns {boolean} 開始できたか(録画中なら false)。
         */
        start(sessionId, upstream) {
            if (proc) return false;                                          // ★二重起動を弾く
            deps.writeFile(`${deps.outDir}/${sessionId}.json`,
                JSON.stringify(sidecar(sessionId, deps.nowIso(), upstream)));
            proc = deps.spawn("ffmpeg", ffmpegArgs(`${deps.outDir}/${videoFilename(sessionId)}`));
            return true;
        },
        /** @param {Uint8Array} jpeg */
        writeFrame(jpeg) { proc?.stdin?.write(jpeg); },
        stop() { if (proc) { proc.stdin?.end(); proc = null; } },          // 確定して idle へ
    };
}
```
→ `node --test`：**+4＝計19 tests pass**／`npm run typecheck`：**型エラー無し**（実測で確認済み）。

### 2.5 `tools/cam-config.mjs`（設定の定数＝単一責務）

`cam-proxy.mjs` が設定値（マジック値）を I/O 配線に直書きしていた＝**設定と配線が混在（SRP違反）**。app の `config.ts` と同じく**設定の置き場を分離**する。

> **置き場は `tools/lib/` でなく `tools/`（トップ直下）**：`lib/` は**純粋・テスト済みのヘルパ専用**（`mjpeg-demux`/`ffmpeg-args`/`multipart`/`recording-paths`/`ffmpeg-recorder` は全て `.test.mjs` を持つ）。cam-config は**ロジックでもテスト対象でもない“値”**なので lib に混ぜると浮く（唯一テストの無いファイルになる）。app が `config.ts` を `src/` 直下に置くのと同じ作法で、**唯一の利用者 `cam-proxy.mjs` の隣（tools 直下）**に置く。`tools/tsconfig.json` の `include` は `*.mjs` を含むので型検査対象のまま。

**env にはしない**：1人・ローカル実行・**ESP32 softAP の固定IP（`192.168.4.1`、ファーム焼き直さない限り不変）**で、`CAM_PORT=...` 等を実際に設定する場面が無い（YAGNI）。しかも env は値を文字列にするので `Number()`＋NaN ガードという**複雑さを自分で生む**——その複雑さを検証するためのテストも要らなくなる。よって**ただの定数オブジェクト**で十分。

```js
// cam-config.mjs — cam-proxy の設定(定数)。値の唯一の置き場。
// env にしない: 1人・ローカル・固定IP(ESP32 softAP=192.168.4.1)で override の出番が無いため(YAGNI)。
// 変えたい時はここを直す。port/URL は app config.ts と重複するので一致させること(§5)。
export const camConfig = {
    upstream: "http://192.168.4.1:81/stream",  // ESP32 softAP の MJPEG(固定)
    port: 8082,                                // プロキシのローカル待受
    outDir: "recordings",                      // 録画出力先
    boundary: "frame",                         // multipart 境界(固定)
};
```
> **テスト不要**：リテラルの定数オブジェクトはロジックが無い（「リテラルが自分と等しい」は検証しない）。tsc が型を保証すれば十分。**＝総テストは 19 のまま**（env版で増やした3テストは“env パースの検証”でしかなかった＝撤去）。

> **これはハードコーディングか？**：いいえ。ロジックに magic 値が埋もれて変えられないのが悪いハードコーディングで、これは**「設定データ」を named module に1箇所集約**したもの＝定数の正しい置き場。**本当に臭うのは別**＝`port 8082`/ESP32 URL が **app `config.ts`（`proxyStreamUrl`/`controlUrl`/`CAM_URL`）と二重定義**で単一情報源が無い点（→ §5）。

---

## 3. プロキシ本体（`tools/cam-proxy.mjs`）— 配線（smoke・型付き）

設定は §2.5 の `cam-config`（定数）、録画の状態機械は §2.4 の `ffmpeg-recorder`（テスト済）に委譲し、本ファイルは **I/O 配線だけ**＝「繋ぐ薄い殻」にする。残る副作用は http ルーティング・上流 `http.get`・client の `Set`・実 `spawn` バインドで、これらは smoke（実行は実機）。`req.url`（path+query）は `?? "/"` で undefined を吸収し、**`new URL` の捨てベース（`http://localhost:...`）を使わず pathname/query を直接取る**——`url.host` は読まないので「localhost」等の紛らわしい magic 値を配線に持ち込まない（port とも結合しない）。`session` は `URLSearchParams` がデコードする（クライアントの `encodeURIComponent` と対）。

```js
// cam-proxy.mjs — ESP32 MJPEG を上流1本で取り、(ブラウザ再配信 + ffmpeg録画) に分配する。smoke検証。
// 設定解決は cam-config、録画状態機械は ffmpeg-recorder(いずれもテスト済) に委譲。本ファイルは I/O 配線だけ。
import http from "node:http";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createDemux, extractFrames } from "./lib/mjpeg-demux.mjs";
import { multipartPart, multipartHeaders } from "./lib/multipart.mjs";
import { createFfmpegRecorder } from "./lib/ffmpeg-recorder.mjs";
import { camConfig } from "./cam-config.mjs";          // ← tools 直下(lib は純テスト済みヘルパ専用)

const { upstream, port, outDir, boundary } = camConfig;   // 定数(YAGNI: env にしない)

/** @type {Set<import("node:http").ServerResponse>} */
const clients = new Set();
// 録画は controller に委譲。spawn/writeFile/nowIso を実体で注入(テストでは fake を注入)。
const rec = createFfmpegRecorder({
    spawn: (cmd, args) => { fs.mkdirSync(outDir, { recursive: true }); return spawn(cmd, args, { stdio: ["pipe", "inherit", "inherit"] }); },
    writeFile: fs.writeFileSync,
    nowIso: () => new Date().toISOString(),
    outDir,
});

// 上流1本を張り、JPEG を分配。(切断時の再接続は §5 リスク参照)
let demux = createDemux();
http.get(upstream, (up) => {
    up.on("data", (chunk) => {
        const r = extractFrames(demux, chunk); demux = r.state;
        for (const jpeg of r.frames) {
            const part = multipartPart(jpeg, boundary);
            for (const res of clients) res.write(part);   // ブラウザへ(multipart)
            rec.writeFrame(jpeg);                         // ffmpeg へ(録画中だけ・controller が判断)
        }
    });
}).on("error", (e) => console.error("[cam] upstream:", e.message));

http.createServer((req, res) => {
    const reqUrl = req.url ?? "/";
    const q = reqUrl.indexOf("?");                                   // base URL は使わない(host は読まないため)
    const pathname = q < 0 ? reqUrl : reqUrl.slice(0, q);
    const params = new URLSearchParams(q < 0 ? "" : reqUrl.slice(q + 1));
    if (pathname === "/stream") {
        res.writeHead(200, multipartHeaders(boundary));
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
    }
    if (pathname === "/rec/start" && req.method === "POST") {
        const id = params.get("session") ?? `cam-${process.hrtime.bigint()}`;
        const ok = rec.start(id, upstream);               // 二重起動の判断は controller(テスト済)
        res.writeHead(ok ? 200 : 409).end(ok ? `recording ${id}.mp4` : "already recording");
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

> **smoke 手順**：PCを `ELEGOO-xxxx` に接続 → `cd tools && node cam-proxy.mjs` → `http://localhost:8082/stream` が映る → `curl -X POST "http://localhost:8082/rec/start?session=test"` → 数秒 → `curl -X POST http://localhost:8082/rec/stop` → `recordings/test.mp4` が**再生でき実時間長**か。**実キャプチャでの demux 検証**もここで（8a 合成テストに実フレームを足す＝EXIF誤分割の有無を確認）。

---

## 4. テストは足りるか（十分性チェック）

| 層 | 担保 | 種別 |
|---|---|---|
| `extractFrames`（8a） | 分岐網羅＋分割不変＋FF00/FFD0耐性 | unit |
| `ffmpegArgs` / `multipart*` / `recording-paths` | 既定/override・boundary/CORS/Content-Length・`<id>.mp4`/サイドカー | unit |
| **`ffmpeg-recorder`（録画状態機械）** | **start/二重起動拒否/録画中のみ流す/idle stop安全**（fake注入） | **unit**（4テスト） |
| `cam-config`（設定の定数） | ロジック無し＝tsc が型を保証（テスト不要） | typecheck |
| 全 tools 純部品 | **JSDoc＋checkJs --strict** で型検査 | typecheck |
| `cam-proxy.mjs` 配線 | http ルーティング・上流1本・client の Set・実 spawn バインド（判断は controller へ委譲済） | **smoke**（実行は実機） |
| ESP32 同時数・帯域・実fps | 実機依存 | **実機検証（§0）** |
| 実 MJPEG 生フォーマット・EXIF | 実機依存 | **実キャプチャ smoke（§3）** |

**結論**：判断・整形・**録画の状態機械**（純関数＋注入）はユニット＋型で固めた——**二重起動拒否は型任せでなくテストで守る**ようになった。プロキシに残るのは真の I/O 配線だけで、**実行時の挙動（特に §5 の再接続）は smoke と実機で要確認**。

---

## 5. リスク・未確認（正直に）
- **上流切断時の再接続が無い**：`http.get` 1本のみ。ESP32 が落ちると stream/録画が**無言で止まる**。→ smoke で要確認、必要なら `up.on("close")` で再接続＋指数バックオフを足す（純部品は無改修で済む）。
- **バックプレッシャ未処理**：遅いブラウザや ffmpeg stdin が詰まると `res.write`/`stdin.write` の戻り値(false)を無視。短時間・低fpsなら実害小だが長時間は要観察。
- **ESP32 同時 stream 数**（§0 で実測）。1ならプロキシ必須。
- **設定の app↔tools 二重定義（DRY違反）**：`port 8082`・ESP32 URL が `app/src/config.ts`（`proxyStreamUrl`/`controlUrl`/`CAM_URL`）と `tools/cam-config.mjs` の**両方**に居る。変更時は両方直す必要。別ランタイム（ブラウザTS／Node）なので import 共有ができないのが原因。**zero-dup を狙うなら** repo ルートに共有 `.env`/JSON を置き、app は Vite env・tools は `process.env`/`fs` で読む（機械が増える）。値が安定な今は「両方一致させる」運用＋コメントで可。
- **EXIF サムネイル誤分割**（[8a §2](stage8a-mjpeg-demux.md)）→ 実キャプチャで確認、必要なら Content-Length パースへ。
- **stage6 同時運用の帯域**：scan の制御往復＋カメラ＋録画で fps 低下/切断（[8c §8](stage8c-browser-and-sync.md)）。

---
関連：[stage8a](stage8a-mjpeg-demux.md)（demux）／ [stage8c](stage8c-browser-and-sync.md)（次：ブラウザ＆stage7同期）／ [design-trajectory-recording-architecture.md](../reference/design-trajectory-recording-architecture.md) §7／ [stage5-wireless-camera.md](stage5-wireless-camera.md)
</content>
