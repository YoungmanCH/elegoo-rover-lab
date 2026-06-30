// multipart.mjs — JPEG を multipart/x-mixed-replace の1パートに包む(純)。ブラウザ<img>へ再配信用。

/**
 * @param {string} boundary
 * @returns {Record<string, string>} multipart 応答ヘッダ。
*/
export function multipartHeaders(boundary) {
    return {
        "Content-Type": `multipart/x-mixed-replace; boundary=${boundary}`,
        "Access-Control-Allow-Origin": "*",   // localhost 経由で <img>/canvas の CORS 汚染を防ぐ
        "Cache-Control": "no-cache",
    };
}

/**
 * @param {Buffer} jpeg
 * @param {string} boundary
 * @returns {Buffer} 1パート(ヘッダ+JPEG+CRLF)。
*/
export function multipartPart(jpeg, boundary) {
    const head = Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
    return Buffer.concat([head, jpeg, Buffer.from("\r\n")]);
}
