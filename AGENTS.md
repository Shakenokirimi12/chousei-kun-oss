# chousei-kun (OSS) — AGENTS.md

> グローバル共通ルール（`~/.agents/AGENTS.md`）に加えて、このリポジトリ固有のルールを定める。
> 衝突した場合はこのファイルが優先。

## 1. これは何か

日程調整アプリ。**このリポジトリは汎用・セルフホスト可能なテンプレート**であり、特定の本番インスタンス
（独自ドメイン、フィードバック宛先、大学ポータル連携、エラートラッカ等）は、これに `.env` と
`wrangler.jsonc` を入れたもの。概念上フォークであって、別管理のコードベースではない。

**この前提を崩さない。特定インスタンス固有の値をコードに直接書かない。**

## 2. 構成

```
app/ components/       Next.js (App Router) + shadcn/ui
migrations/            D1 のマイグレーション
wrangler.jsonc         本番の設定。gitignore 対象
wrangler.jsonc.example コミットされるひな形。設定項目を増やしたらこちらも更新する
cloudflare-env.d.ts    生成物。手で編集しない
open-next.config.ts    OpenNext (Cloudflare adapter) の設定
```

## 3. 技術スタック

| 層 | 技術 |
|---|---|
| フロント | Next.js (App Router) + Tailwind + shadcn/ui |
| API | Hono |
| 実行環境 | Cloudflare Workers（`@opennextjs/cloudflare` 経由） |
| DB | Cloudflare D1 |
| パッケージ管理 | pnpm（`pnpm-workspace.yaml` あり） |

## 4. セットアップと実行

```bash
pnpm install
cp wrangler.jsonc.example wrangler.jsonc   # 値を埋める
pnpm dev
```

- ローカルのシークレットは `.dev.vars`（gitignore 済み）。`.env` / `wrangler.jsonc` に平文で書かない。

## 5. 完了前に通す

```bash
pnpm lint
pnpm build
```

## 6. 固有のルール

- `wrangler.jsonc` のバインディングを変えたら `pnpm cf-typegen` を実行する。`cloudflare-env.d.ts` を手で直さない。
- D1 のスキーマ変更は必ず `migrations/` に追加する。既存マイグレーションを書き換えない。
- 本番インスタンス固有の文字列（ドメイン、宛先アドレス、大学名）をハードコードしない。設定から読む。
- `Code.gs` は Google Apps Script 側の連携スクリプト。ビルド対象ではない。

## 7. デプロイ

```bash
pnpm deploy
```

- 本番反映。共通ルール4により、実行前に確認を取る。
- D1 のスキーマ変更・データ削除も同様に確認対象。

## 8. Git

- リモート: `https://github.com/Shakenokirimi12/chousei-kun-oss.git`（**公開リポジトリ**）
- 公開前提なので、コミットに含める内容に注意する。
