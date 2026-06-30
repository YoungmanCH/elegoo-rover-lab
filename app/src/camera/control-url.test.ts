import { describe, it, expect } from "vitest";
import { recControlUrl } from "./control-url";

describe("recControlUrl", () => {
    it("start: session をクエリに付ける", () => {
        expect(recControlUrl("http://localhost:8082", "start", "2026-06-30T10-00-00-000Z"))
            .toBe("http://localhost:8082/rec/start?session=2026-06-30T10-00-00-000Z");
    });
    it("stop: /rec/stop", () => {
        expect(recControlUrl("http://localhost:8082", "stop", "x")).toBe("http://localhost:8082/rec/stop");
    });
    it("特殊文字はエンコード(防御的)", () => {
        expect(recControlUrl("http://x", "start", "a/b c")).toBe("http://x/rec/start?session=a%2Fb%20c");
    });
});
