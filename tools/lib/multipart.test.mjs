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
