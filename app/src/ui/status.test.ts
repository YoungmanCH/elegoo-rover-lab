import { describe, it, expect } from "vitest";
import { linkStatusView } from "./status";

describe("linkStatusView（接続種別→ヘッダ表示）", () => {
    it("sim=架空・tone sim", () => {
        expect(linkStatusView("sim")).toEqual({ label: "SIM · 架空環境", tone: "sim" });
    });

    it("usb=live", () => {
        expect(linkStatusView("usb")).toEqual({
            label: "LINK · USB",
            tone: "live",
        });
    });

    it("wifi=live", () => { expect(linkStatusView("wifi")).toEqual({ 
        label: "LINK · WiFi", 
        tone: "live"
    })});
});
