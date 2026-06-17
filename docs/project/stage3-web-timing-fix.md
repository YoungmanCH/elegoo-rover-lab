# 段階3：Web 側タイミング修正（read timeout の解消）

> firmware は修正済み（[stage3-debug-serial.md](stage3-debug-serial.md) §6）。ここはブラウザ側の `read()` が落ちる残課題（§7）を直す。編集は2ファイル・計2か所。

## なぜ落ちるか（要約）
1. **起動と read の競合**：`port.open()` が Arduino をリセットする。UNO は「ブートローダ待ち（約1〜2秒）＋ `setup()`（chip_id 出力 約100ms）」のあいだ無応答。ここに read を撃つと間に合わない。
2. **off-by-one**：`TIMEOUT_MS=300` が短く、各 query が自分の応答を待ちきれず諦める → 遅れて届いた `{21_0}` を次の query が拾う（応答が1個ズレる）。
3. **起動ノイズの残骸**：`port.open()` 直後に流れる chip_id や古い `{21_0}` が受信バッファに残り、最初の read を汚す。

→ 対策は「**起動を十分待つ → 残骸を捨てる → 各 query は自分の応答を長めに待つ**」。

---

## 修正1：`app/src/io/serial-robot.ts`
`TIMEOUT_MS` を伸ばす。各 query が自分の応答を待てるようになり、off-by-one も解消する。

### Before
```ts
const TIMEOUT_MS = 300;      // 1問い合わせの応答待ち上限
```

### After
```ts
const TIMEOUT_MS = 1500;     // 1問い合わせの応答待ち上限(実機は超音波pingやloop周期で数百ms掛かるため余裕を持たせる)
```

---

## 修正2：`app/src/io/transport.ts` の `open()`
リセット待ちを少し伸ばし（ブートローダ＋setup を確実に跨ぐ）、**返す直前に受信バッファと在庫フレームを捨てる**。

### Before
```ts
static async open(): Promise<SerialTransport> {
    const port = await navigator.serial.requestPort();      // ユーザー操作内で
    await port.open({ baudRate: BAUD });
    const writer = port.writable!.getWriter();
    const t = new SerialTransport(port, writer);
    void t._readLoop();                                      // 背景で受信し続ける
    await new Promise((r) => setTimeout(r, 2000));          // Arduino 自動リセット待ち
    return t;
}
```

### After
```ts
static async open(): Promise<SerialTransport> {
    const port = await navigator.serial.requestPort();      // ユーザー操作内で
    await port.open({ baudRate: BAUD });
    const writer = port.writable!.getWriter();
    const t = new SerialTransport(port, writer);
    void t._readLoop();                                      // 背景で受信し続ける
    await new Promise((r) => setTimeout(r, 2500));          // Arduino 自動リセット待ち(ブートローダ約2秒+setupを跨ぐ)

    // 起動ノイズ(chip_id や古い {21_0})を捨てて、最初の read を汚さない
    // ※ frames/buffer は private だが static メソッドは同一クラスなのでアクセス可
    t.frames.length = 0;
    t.buffer = "";

    return t;
}
```

### ポイント
- `frames.length = 0` は配列を空にするイディオム（中身を全部捨てる）。
- `2500` は目安。もし最初の read でまだ chip_id を拾うようなら `3000` に。逆に速いなら詰めてよい。

---

## 動作確認の手順
1. 2か所を編集して保存（Vite が自動リロード）。
2. **ページをリロード → 実機接続を1回クリック**（二重 open の `already open` を避ける）。
3. コンソールで確認：
   - **期待**：`[TX] {"H":"21"...}` の直後に `[RX] "{21_0}"` が来て、`read失敗` が出ない。距離が取れる。
   - まだ落ちるなら、`[TX]` と `[RX]` の並びを貼ってほしい（待ち時間 or 残骸の取りこぼしを再調整する）。
4. read が安定したら「開始」で自走（壁検知→旋回）に進む。

---
関連：[stage3-debug-serial.md](stage3-debug-serial.md)（原因究明と firmware 修正）
