# 段階8a：MJPEG フレーム分解器（純・型付き）— TDD

> **ゴール**：ESP32 の MJPEG（`multipart/x-mixed-replace`）の**生バイト列から JPEG フレームを1枚ずつ切り出す純関数** `extractFrames` を TDD で作る。録画（ffmpeg）と再配信（ブラウザ `<img>`）の共通供給源＝**カメラ録画の心臓**。
> **設計の肝**：I/O を持たない**状態付き純関数**にして、**チャンク分割で届く現実**を実機なしに網羅。**tools/ も型を書く**：`.mjs` のまま `node` で直接実行しつつ、**JSDoc＋`checkJs` で strict 型検査**する（app と同じ厳格さを Node 側にも）。
> **前提**：`tools/`（[stage5](stage5-wireless-camera.md) の `ws-bridge.mjs` と同じ Node 純正環境）。stage6/7 のコードには依存しない（純バイト処理）。全体設計は [design-trajectory-recording-architecture.md](../reference/design-trajectory-recording-architecture.md) §7。
> **このstageの位置**：8a(本書) → [8b 録画パイプライン](stage8b-recording-pipeline.md) → [8c ブラウザ＆同期](stage8c-browser-and-sync.md)。

---

## 0. tools の型付け環境（最初に用意）

app は strict TS。tools も**同じ厳格さ**にする。`.ts` 化すると Node 直実行に loader が要る（Node20 は `.ts` 不可）ので、**`.mjs`＋JSDoc＋`checkJs`** を採用＝`node cam-proxy.mjs` も `node --test` もそのまま、かつ `tsc` が型を検査。

### `tools/tsconfig.json`（新規）
```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["lib/**/*.mjs", "*.mjs"],
  "exclude": ["lib/**/*.test.mjs"]
}
```

### `tools/package.json`（追記）
```json
{
  "name": "ws-bridge", "private": true, "type": "module",
  "dependencies": { "ws": "^8.18.0" },
  "devDependencies": { "@types/node": "^20.19.0", "typescript": "^5.7.0" },
  "scripts": { "test": "node --test lib/", "typecheck": "tsc -p tsconfig.json" }
}
```
> **`@types/node` は実行する Node に合わせ 20系**（TS5.7 互換の最近版。古い18系は TS5.7 の generic TypedArray と衝突する）。`cd tools && npm i` → `npm run typecheck` で型、`npm test` で動作。

---

## 1. 増分：`extractFrames`（バイト列 → JPEGフレーム列）

### ① テストを先に書く（RED）
`tools/lib/mjpeg-demux.test.mjs`（**node:test**。tools は Node なので標準テストランナ＝追加依存ゼロ）
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemux, extractFrames } from "./mjpeg-demux.mjs";   // ← まだ無い。RED

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const jpeg = (n) => Buffer.concat([SOI, Buffer.alloc(n, 0x42), EOI]);   // 中身ダミー
const boundary = Buffer.from("\r\n--frame\r\nContent-Type: image/jpeg\r\n\r\n");

test("完全1枚 → 1フレーム・余り無し", () => {
    const r = extractFrames(createDemux(), jpeg(4));
    assert.equal(r.frames.length, 1);
    assert.deepEqual(r.frames[0], jpeg(4));
    assert.equal(r.state.buf.length, 0);
});
test("連結2枚 → 2フレーム", () => {
    const r = extractFrames(createDemux(), Buffer.concat([jpeg(2), boundary, jpeg(3)]));
    assert.equal(r.frames.length, 2);
    assert.deepEqual(r.frames[1], jpeg(3));
});
test("境界無しで EOI直後に SOI → 2フレーム", () => {
    const r = extractFrames(createDemux(), Buffer.concat([jpeg(2), jpeg(3)]));
    assert.equal(r.frames.length, 2);
});
test("本体に FF00(スタッフィング)/FFD0(リスタート)があっても誤分割しない", () => {
    const body = Buffer.from([0x42, 0xff, 0x00, 0x42, 0xff, 0xd0, 0x42]);   // FF00 と FFD0 を含む本体
    const one = Buffer.concat([SOI, body, EOI]);
    const r = extractFrames(createDemux(), Buffer.concat([one, boundary, one]));
    assert.equal(r.frames.length, 2);                  // FF00/FFD0 を EOI(FFD9)と誤認しない
    assert.deepEqual(r.frames[0], one);
});
test("EOI 未達 → 0フレーム・SOIから残す", () => {
    const partial = Buffer.concat([SOI, Buffer.alloc(3, 0x42)]);
    const r = extractFrames(createDemux(), partial);
    assert.equal(r.frames.length, 0);
    assert.deepEqual(r.state.buf, partial);
});
test("チャンク分断(EOI跨ぎ) → 2回目でフレーム", () => {
    const full = jpeg(4);
    let r = extractFrames(createDemux(), full.subarray(0, 4));
    assert.equal(r.frames.length, 0);
    r = extractFrames(r.state, full.subarray(4));
    assert.equal(r.frames.length, 1);
    assert.deepEqual(r.frames[0], full);
});
test("チャンク分断(SOI跨ぎ:末尾FF)を落とさない", () => {
    const full = jpeg(2);
    let r = extractFrames(createDemux(), Buffer.from([0xff]));
    assert.equal(r.frames.length, 0);
    assert.equal(r.state.buf.length, 1);               // 末尾の単独 FF を保持
    r = extractFrames(r.state, full.subarray(1));
    assert.equal(r.frames.length, 1);
    assert.deepEqual(r.frames[0], full);
});
test("先頭ゴミ(multipartヘッダ)を読み飛ばす", () => {
    const r = extractFrames(createDemux(), Buffer.concat([boundary, jpeg(3)]));
    assert.equal(r.frames.length, 1);
    assert.deepEqual(r.frames[0], jpeg(3));
});
test("分割の仕方に依らず同じフレーム列(無損失)", () => {
    const stream = Buffer.concat([jpeg(2), boundary, jpeg(5), boundary, jpeg(1)]);
    let s = createDemux(); const out = [];
    for (const byte of stream) {                       // 1バイトずつ流す極端ケース
        const r = extractFrames(s, Buffer.from([byte]));
        out.push(...r.frames); s = r.state;
    }
    assert.equal(out.length, 3);
    assert.deepEqual(out[1], jpeg(5));
});
```
→ `cd tools && node --test lib/`：`mjpeg-demux.mjs` 不在で**赤**。

> **ハングを fail に変える**：`node --test` には既定タイムアウトが無く、実装が無限ループすると**赤にならず無言で止まる**（＝原因切り分け不能）。実装の停止性が崩れ得る本関数では、各テストに `node:test` の `{ timeout }` を付け、停止しないコードを**数秒で fail**させる：
> ```js
> test("完全1枚 → 1フレーム・余り無し", { timeout: 1000 }, () => { /* … */ });
> ```
> （Node20系は CLI の `--test-timeout` 非対応のため**テスト単位の `{ timeout }`** を使う。これで「終わらない」が「1秒で fail」に変わる。）

### ② 最小実装でGREEN（JSDoc 型付き）
`tools/lib/mjpeg-demux.mjs`
```js
// mjpeg-demux.mjs — MJPEG のバイト列から JPEG フレームを切り出す(純・状態あり)。
// JPEG は SOI(FF D8)〜EOI(FF D9)。エントロピー中の生 FF は FF00 にスタッフィングされ FF D9 は EOI のみ。
// boundary 文字列は ASCII で非ASCIIの SOI/EOI と衝突しないので無視してよい。
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/** @typedef {{ buf: Buffer }} DemuxState 未完成バイトを溜める状態。 */

/** @returns {DemuxState} 新しい空の状態。 */
export function createDemux() {
    return { buf: Buffer.alloc(0) };
}

/**
 * バイト列から完成した JPEG フレームを切り出す。
 * @param {DemuxState} state 前回までの未完バイト。
 * @param {Buffer} chunk 新たに届いたバイト列。
 * @returns {{ frames: Buffer[], state: DemuxState }} 完成フレーム列と次状態。
 */
export function extractFrames(state, chunk) {
    let buf = Buffer.concat([state.buf, chunk]);
    /** @type {Buffer[]} */
    const frames = [];
    // 【停止性の不変条件】各反復は必ず (a)break する か (b)buf を厳密に縮める のどちらか。
    //   SOI無し→break / EOI無し→buf=buf.subarray(soi)で末尾へ縮め break / 完成→buf=buf.subarray(eoi+2)で前進。
    //   この不変条件が崩れると buf 不変のまま回り続け `node --test` が無言でハングする。最優先で死守。
    for (;;) {
        const soi = buf.indexOf(SOI);
        if (soi < 0) {
            // SOI 未到来。次チャンク先頭が D8 で SOI になり得るので末尾の単独 FF だけ残す。
            buf = buf.length > 0 && buf[buf.length - 1] === 0xff ? buf.subarray(buf.length - 1) : Buffer.alloc(0);
            break;
        }
        const eoi = buf.indexOf(EOI, soi + 2);
        if (eoi < 0) { buf = buf.subarray(soi); break; }   // フレーム未完。SOI から残す
        frames.push(buf.subarray(soi, eoi + 2));
        buf = buf.subarray(eoi + 2);
    }
    return { frames, state: { buf } };
}
```
→ `node --test`：**9 tests pass**／`npm run typecheck`：**型エラー無し**（いずれも実測で確認済み）。

---

## 2. テストは足りるか（十分性チェック）

| 観点 | 確認 |
|---|---|
| **分岐網羅** | 3分岐（SOI無し／EOI無し／完成）すべてにテスト。 |
| **ループ停止（無限ループ防止）** | 停止性の不変条件（各反復が break か `buf` 厳密縮小）を実装コメントで固定。万一崩れると `node --test` が無言でハングするため、**`{ timeout }` 付き**でテストを回しハングを fail に変換する（下記）。 |
| **境界・分割** | 完全1枚／連結2枚／EOI直後SOI／EOI未達／**EOI跨ぎ分断**／**SOI跨ぎ分断(末尾FF)**／先頭ゴミ。 |
| **JPEG規約への依存** | **FF00(スタッフィング)/FFD0-D7(リスタート)を EOI と誤認しない**ことを明示テスト（SOI/EOI走査の正当性の核）。 |
| **無損失（不変条件）** | 1バイトずつ流しても同じ3枚＝分割不変。 |
| **型** | JSDoc＋`checkJs --strict` で `extractFrames`/`createDemux` の引数・戻り値が検査済み（`DemuxState`/`Buffer[]`）。 |
| **カバレッジ** | `mjpeg-demux.mjs` 行カバレッジ 100%（純）。 |
| **既知の限界（正直に）** | **EXIF サムネイル等で JPEG 内に別の `FF D8…FF D9` が埋まっていると誤分割し得る**（SOI/EOI走査の原理的限界）。ESP32-CAM(OV2640) の生 JPEG はサムネイルを埋めないので実害は無い見込みだが、**[8b](stage8b-recording-pipeline.md) の実キャプチャ smoke で確認**。必要なら multipart の `Content-Length` 厳密パースへ切替（テストも追加）。 |

**結論**：demux の純ロジックは分岐網羅＋分割不変＋JPEG規約耐性＋型まで固めており十分。残るのは「実ストリームの生フォーマット差／EXIF埋め込み」だけで、実キャプチャ smoke（8b）で潰す。

---
関連：[stage8b](stage8b-recording-pipeline.md)（次：プロキシ＋ffmpeg）／ [design-trajectory-recording-architecture.md](../reference/design-trajectory-recording-architecture.md) §7／ [stage5-wireless-camera.md](stage5-wireless-camera.md)
</content>
