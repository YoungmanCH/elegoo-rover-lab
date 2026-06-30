import { describe, it, expect } from "vitest";
import { cameraStreamUrl } from "./stream-url";
import type { RecordingConfig } from "../types";

const cfg = (over: Partial<RecordingConfig> = {}): RecordingConfig => ({
    directStreamUrl: "http://192.168.4.1:81/stream",
    proxyStreamUrl: "http://localhost:8082/stream",
    controlUrl: "http://localhost:8082",
    useProxy: true, ...over
});

describe("cameraStreamUrl", () => {
    it("useProxy=true → プロキシ", () => { 
        expect(cameraStreamUrl(cfg())).toBe("http://localhost:8082/stream"); 
    });
    it("useProxy=false → 直URL", () => { 
        expect(cameraStreamUrl(cfg({ useProxy: false }))).toBe("http://192.168.4.1:81/stream"); 
    });
});
