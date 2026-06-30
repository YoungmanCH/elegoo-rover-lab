import { describe, expect, it } from "vitest";
import { recordingFilename } from "./download";

describe("recordingFilename", () => {
    it("sessionId と拡張子からファイル名を組む", () => {
        expect(recordingFilename("2026-06-28T12-00-00", "ndjson")).toBe("trajectory-2026-06-28T12-00-00.ndjson");
        expect(recordingFilename("s1", "csv")).toBe("trajectory-s1.csv");
    });
});
