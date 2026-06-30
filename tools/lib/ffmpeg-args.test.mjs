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
