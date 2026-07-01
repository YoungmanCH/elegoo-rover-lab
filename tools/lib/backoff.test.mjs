import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffMs } from "./backoff.mjs";

test("指数で増え、maxMs で頭打ち", { timeout: 1000 }, () => {
    assert.equal(backoffMs(0, 500, 8000), 500);
    assert.equal(backoffMs(1, 500, 8000), 1000);
    assert.equal(backoffMs(2, 500, 8000), 2000);
    assert.equal(backoffMs(5, 500, 8000), 8000);   // 500*32=16000 → 8000 で cap
});
