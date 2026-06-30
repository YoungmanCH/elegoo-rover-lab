// cam-proxy.mjs — ESP32 MJPEG を上流1本で取り、(ブラウザ再配信 + ffmpeg録画) に分配する。
// 設定解決は cam-config、録画状態機械は ffmpeg-recorder に委譲。本ファイルは I/O 配線だけ。
import http from "node:http";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createDemux, extractFrames } from "./lib/mjpeg-demux.mjs";
import { multipartPart, multipartHeaders } from "./lib/multipart.mjs";
import { createFfmpegRecorder } from "./lib/ffmpeg-recorder.mjs";
import { camConfig } from "./cam-config.mjs";

const { upstream, port, outDir, boundary } = camConfig;   // 定数(YAGNI: env にしない)

/** @type {Set<import("node:http").ServerResponse>} */

const clients = new Set();

// spawn/writeFile/nowIso を実体で注入(テストでは fake を注入)。
const rec = createFfmpegRecorder({
    spawn: (cmd, args) => { 
        fs.mkdirSync(outDir, { recursive: true });
        return spawn(cmd, args, { stdio: ["pipe", "inherit", "inherit"] });
    },
    writeFile: fs.writeFileSync,
    nowIso: () => new Date().toISOString(),
    outDir,
});

// 上流1本を張り、JPEG を分配。
let demux = createDemux();
http.get(upstream, (up) => {
    up.on("data", (chunk) => {
        const r = extractFrames(demux, chunk);
        demux = r.state;
        for (const jpeg of r.frames) {
            const part = multipartPart(jpeg, boundary);
            for (const res of clients) res.write(part);     // ブラウザへ(multipart)
            rec.writeFrame(jpeg);                           // ffmpeg へ(録画中だけ・controller が判断)
        }
    });
}).on("error", (e) => console.error("[cam] upstream:", e.message));

http.createServer((req, res) => {
    const reqUrl = req.url ?? "/";
    const q = reqUrl.indexOf("?");                                   // base URL は使わない(host は読まないため)
    const pathname = q < 0 ? reqUrl : reqUrl.slice(0, q);
    const params = new URLSearchParams(q < 0 ? "" : reqUrl.slice(q + 1));

    if (pathname === "/stream") {
        res.writeHead(200, multipartHeaders(boundary));
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
    }

    if (pathname === "/rec/start" && req.method === "POST") {
        const id = params.get("session") ?? `cam-${process.hrtime.bigint()}`;
        const ok = rec.start(id, upstream);             // 二重起動の判断は controller(テスト済)
        res.writeHead(ok ? 200 : 409).end(ok ? `recording ${id}.mp4` : "already recording");
        return;
    }

    if (pathname === "/rec/stop" && req.method === "POST") {
        rec.stop();
        res.writeHead(200).end("stopped");
        return;
    }
    res.writeHead(404).end();
}).listen(port, () => console.log(`[cam] proxy http://localhost:${port}  upstream ${upstream}`));
