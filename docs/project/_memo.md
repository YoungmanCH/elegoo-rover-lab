simの旋回については、実機と比べて全然曲がっていない。また、首振りの角度は確認はできていないのだが、実測値なのだろうか。
usb経由で実行すると、動いていることはわかった。そして、首振りだったり移動も確認できた。ただし、重大点として、停止ボタンが効かない。usbのケーブルを直接抜くしか停止できない。緊急停止もできないため、要修正必須。
保存データ：
/Users/youngman/Downloads/trajectory-2026-07-01T00-25-17-423Z.csv 
/Users/youngman/Downloads/trajectory-2026-07-01T00-25-17-423Z.ndjson 

usb経由の場合、arduinoのide経由でポートを選択しないと動かないのはすごく不便。

wifiの場合、localhost:5173の方ではカメラの接続ができているが、http://192.168.4.1/　こちらではカメラ画像が見えない。

http://192.168.4.1:81/stream　これも何も映らないかな

Wifiの場合、無線で自走（[tick] dist=… が流れる）／停止/Esc/Space で止まる（ブラウザ閉じても ESP32 自動停止）が確認できた。ただし、走行すると、カメラの映像が映らなくなった。また、走行すると、http://192.168.4.1:81/stream　こっちに急に映るようになった。ただし、こっちは接続した段階ではカメラに映らない。

node cam-proxy.mjs　を実行すると下記のエラーが発生した。

(base) youngman@Youngmans-MacBook-Air tools % node cam-proxy.mjs
[cam] proxy http://localhost:8082  upstream http://192.168.4.1:81/stream
node:fs:2380
    return binding.writeFileUtf8(
                   ^

Error: ENOENT: no such file or directory, open 'recordings/2026-07-01T00-38-13-489Z.json'
    at Object.writeFileSync [as writeFile] (node:fs:2380:20)
    at Object.start (file:///Users/youngman/practice/Elegoo/tools/lib/ffmpeg-recorder.mjs:31:18)
    at Server.<anonymous> (file:///Users/youngman/practice/Elegoo/tools/cam-proxy.mjs:57:24)
    at Server.emit (node:events:524:28)
    at parserOnIncoming (node:_http_server:1139:12)
    at HTTPParser.parserOnHeadersComplete (node:_http_common:118:17) {
  errno: -2,
  code: 'ENOENT',
  syscall: 'open',
  path: 'recordings/2026-07-01T00-38-13-489Z.json'
}

