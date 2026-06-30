// cam-config.mjs — cam-proxy の設定(定数)。値の唯一の置き場。
// 1人・ローカル・固定IP(ESP32 softAP=192.168.4.1)で override の出番が無いため(YAGNI)。
// 変えたい時はここを直す。port/URL は app config.ts と重複するので一致させること(§5)。
export const camConfig = {
    upstream: "http://192.168.4.1:81/stream",  // ESP32 softAP の MJPEG(固定)
    port: 8082,                                // プロキシのローカル待受
    outDir: "recordings",                      // 録画出力先
    boundary: "frame",                         // multipart 境界(固定)
};
