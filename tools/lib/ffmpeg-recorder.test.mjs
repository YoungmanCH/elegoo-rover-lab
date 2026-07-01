import { test } from "node:test";
import assert from "node:assert/strict";
import { createFfmpegRecorder } from "./ffmpeg-recorder.mjs";

function setup() {
    const calls = [];       // 呼び順を記録(ordering 検証=バグの本質)
    const log = { spawns: [], files: [], ended: 0, written: [] };
    const fakeProc = { stdin: { write: (b) => log.written.push(b), end: () => { log.ended++; } } };
    const deps = {
        ensureDir: (d) => calls.push(`ensureDir:${d}`),
        writeFile: (p) => calls.push(`writeFile:${p}`),
        spawn: (cmd, args) => { 
            calls.push("spawn"); 
            log.spawns.push({ cmd, args }); 
            return fakeProc; 
        },
        nowIso: () => "2026-06-30T10:00:00.000Z",
        outDir: "rec",
    };
    return { calls, log, c: createFfmpegRecorder(deps) };
}

test("二重 start を弾く(旧プロセスをリークしない)", { timeout: 1000 }, () => {
    const { calls, c } = setup();
    c.start("s1", "up");
    assert.equal(c.start("s2", "up"), false);       // 2回目は拒否
    assert.equal(calls.filter((x) => x === "spawn").length, 1);     // spawn は1回だけ
});

test("start: ensureDir → writeFile → spawn の順(ENOENT回避の要)", { timeout: 1000 }, () => {
    const { calls, c } = setup();
    assert.equal(c.start("s1", "http://up"), true);
    assert.deepEqual(calls, ["ensureDir:rec", "writeFile:rec/s1.json", "spawn"]);   // dir を先に作る
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
    c.stop();
    assert.equal(log.ended, 1);
});
