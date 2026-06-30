import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemux, extractFrames } from "./mjpeg-demux.mjs";

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
    assert.equal(r.frames.length, 2);           // FF00/FFD0 を EOI(FFD9)と誤認しない
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
    assert.equal(r.state.buf.length, 1);                        // 末尾の単独 FF を保持
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
    let s = createDemux();
    const out = [];
    for (const byte of stream) {                                // 1バイトずつ流す極端ケース
        const r = extractFrames(s, Buffer.from([byte]));
        out.push(...r.frames);
        s = r.state;
    }
    assert.equal(out.length, 3);
    assert.deepEqual(out[1], jpeg(5));
});
