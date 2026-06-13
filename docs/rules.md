# 開発ルール (Rules)

このプロジェクトで守る、ブランチ運用とコミットメッセージの一般的なルールをまとめます。

---

## 1. ブランチ運用ルール

### ブランチの種類

| ブランチ | 用途 |
| --- | --- |
| `main` | リリース可能な安定版。直接コミットしない |
| `develop` | 開発の統合ブランチ（任意） |
| `feature/*` | 新機能の開発 |
| `fix/*` | バグ修正 |
| `hotfix/*` | 本番の緊急修正 |
| `docs/*` | ドキュメントのみの変更 |
| `refactor/*` | 挙動を変えないリファクタリング |

### ブランチ名の付け方

- 英小文字・ハイフン区切り（kebab-case）を使う
- `種類/内容` の形式にする
- 必要ならIssue番号を含める

```
feature/add-login-form
fix/header-overflow
fix/123-null-pointer
docs/update-readme
```

### 基本フロー

```bash
# 1. 最新の main を取得
git switch main
git pull origin main

# 2. 作業ブランチを切る
git switch -c feature/add-login-form

# 3. 作業してコミット
git add .
git commit -m "feat: ログインフォームを追加"

# 4. リモートへプッシュ
git push -u origin feature/add-login-form

# 5. Pull Request を作成してレビュー後にマージ
```

---

## 2. コミットメッセージルール

[Conventional Commits](https://www.conventionalcommits.org/) に準拠します。

### フォーマット

```
<type>: <要約>

<本文（任意）>

<フッター（任意）>
```

### type 一覧

| type | 意味 |
| --- | --- |
| `feat` | 新機能の追加 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみの変更 |
| `style` | 動作に影響しない変更（空白・フォーマット等） |
| `refactor` | バグ修正でも機能追加でもないコード変更 |
| `perf` | パフォーマンス改善 |
| `test` | テストの追加・修正 |
| `build` | ビルドシステムや依存関係の変更 |
| `ci` | CI設定の変更 |
| `chore` | その他の雑務（上記以外） |
| `revert` | コミットの取り消し |

### 書き方のルール

- 要約は **50文字以内** を目安に簡潔に
- 要約の先頭は動詞、命令形（「〜を追加」「〜を修正」）
- 要約の末尾にピリオド `.` を付けない
- 「何を」だけでなく、必要なら本文で「なぜ」を書く
- 1コミット＝1つの意味のある変更にまとめる

### 例

```
feat: ユーザー認証機能を追加

JWTを使ったトークン認証を実装。
ログイン・ログアウトのエンドポイントを追加した。
```

```
fix: 空配列のときにクラッシュする問題を修正
```

```
docs: READMEにセットアップ手順を追記
```

---

## 3. Pull Request / マージルール

- マージ前に必ずレビューを受ける
- コンフリクトは作業ブランチ側で解消してからマージする
- マージ後は作業ブランチを削除する

```bash
# マージ後のブランチ削除
git branch -d feature/add-login-form
git push origin --delete feature/add-login-form
```

### マージ方法の方針

- 履歴をきれいに保ちたい場合は **Squash and merge** を推奨
- 経緯を残したい場合は通常の **Merge commit**
- 履歴を直線的にしたい場合は **Rebase and merge**

> プロジェクトでどれを使うかは統一しておくこと。
