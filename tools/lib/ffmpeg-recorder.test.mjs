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
    assert.ok(log.spawns[0].args.at(-1).endsWith("rec/s1.mp4"));    // 出力先が <id>.mp4
    assert.ok(log.files[0].p.endsWith("rec/s1.json"));              // サイドカーを書く
    assert.match(log.files[0].d, /"videoFile":"s1\.mp4"/);          // 軌跡と対になる videoFile
});

test("二重 start を弾く(旧プロセスをリークしない)", { timeout: 1000 }, () => {
    const { log, c } = setup();
    c.start("s1", "up");
    assert.equal(c.start("s2", "up"), false);       // 2回目は拒否
    assert.equal(log.spawns.length, 1);             // spawn は1回だけ
});

test("writeFrame: 録画中だけ stdin に流す", { timeout: 1000 }, () => {
    const { log, c } = setup();
    c.writeFrame(Buffer.from([1]));                 // 録画前は無視(no-op)
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
    c.stop();                                       // idle で呼んでも例外なし
    assert.equal(log.ended, 1);                     // 二重に end しない
});
