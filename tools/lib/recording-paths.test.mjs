import { test } from "node:test";
import assert from "node:assert/strict";
import { videoFilename, sidecar } from "./recording-paths.mjs";

test("videoFilename: sessionId.mp4", () => {
    assert.equal(
        videoFilename("2026-06-30T10-00-00-000Z"), "2026-06-30T10-00-00-000Z.mp4"
    );
});

test("sidecar: 軌跡と同じ sessionId/videoFile", () => {
    const s = sidecar("s1", "2026-06-30T10:00:00.000Z", "http://192.168.4.1:81/stream");
    assert.equal(s.videoFile, "s1.mp4");
    assert.equal(s.startedAtIso, "2026-06-30T10:00:00.000Z");
    assert.equal(s.upstream, "http://192.168.4.1:81/stream");
});
