# diy-roomba app（Web層）

ELEGOO Smart Robot Car V4.0 を「自作ルンバ」として動かすシステムの **Web層（頭脳側）**。
掃除ロジック（純関数）＋ 2Dシミュレータ ＋ Web Serial 経由の実機制御 ＋ UI を TypeScript で収める。サーバ不要。

> ⚠️ **このリポジトリは2層構成。`app/` はそのうちの Web層**。実機ファーム（UNO層・C++）は **`app/` の中ではなく兄弟ディレクトリ** `../arduino/` にある。
> ```
> elegoo-rover-lab/
> ├── app/        ← ここ（Web層 / TypeScript / npm・Vite）
> ├── arduino/    ← UNO層（C++ / Arduino スケッチ）  ※兄弟。app には入れない
> └── docs/
> ```
> 2層の役割分担・境界（シリアルJSON）・全体設計 → [../docs/project/code-design.md](../docs/project/code-design.md)

## 方針（なぜこの構成か）

ブレイン（掃除ロジック）を**ハード非依存の純関数**にし、`RobotIO` インターフェースの先に「シム」と「実機(Web Serial)」を差し替えで置く。
→ **実機を待たずシム＋単体テストで開発**でき、同じロジックをそのまま実機へ。
※ 実機での角度旋回に要る Yaw は、UNO層に `N=24` を足して**データとして**供給する（判断は Web 側に置く）。詳細は設計書 §4–§5。

## セットアップ

```bash
cd app
npm install
```

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm test` | 単体テスト（Vitest, watch） |
| `npm run test:run` | 単体テスト（1回実行） |
| `npm run typecheck` | 型チェック（`tsc --noEmit`） |
| `npm run dev` | 開発サーバ（Vite）※ `index.html` 追加後（段階2）から有効 |
| `npm run build` | 本番ビルド |

## 構成（`app/` 内・予定）

```
app/
├── index.html          # UI/シム表示（段階2）
└── src/
    ├── config.ts       # 全パラメータの集約（ハードコーディング排除）
    ├── types.ts        # 型＝契約
    ├── domain/         # cleaning.ts（純粋状態機械）＋ test
    ├── protocol/       # JSON⇄コマンド（純粋／境界のWeb側実装）＋ test
    ├── io/             # robot.ts(IF) / serial-robot.ts / transport.ts
    ├── sim/            # model.ts（純粋）＋ sim-robot.ts ＋ test
    ├── runner.ts       # 制御ループ read→step→send
    └── ui.ts           # DOM・描画
```

責務・依存関係・システムフローの詳細は [../docs/project/code-design.md](../docs/project/code-design.md)、ロジック仕様は [../docs/project/cleaning-logic-spec.md](../docs/project/cleaning-logic-spec.md)。

## 現状

土台（`package.json` / `tsconfig.json` / 本 README）のみ。
次は段階1：`config.ts` / `types.ts` → `domain/cleaning.ts` ＋ 単体テスト（実機不要）。

## 動作環境（実機接続時）

Web Serial API を使うため **Chrome / Edge**（Firefox/Safari非対応）。Linux + Chrome で CH340 はそのまま認識。

## 環境要件

Node.js 18+ を想定。
