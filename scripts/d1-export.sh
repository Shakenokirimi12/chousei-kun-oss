#!/usr/bin/env bash
# D1 のリモートデータベースをローカルにダンプするヘルパースクリプト。
#
# 使い方:
#   ./scripts/d1-export.sh                # 既定の DB 名 "chosei-kun-db"
#   DB_NAME=other-db ./scripts/d1-export.sh
#
# 出力先: backups/<DB_NAME>-YYYYMMDDTHHMMSSZ.sql
#
# 復元手順:
#   wrangler d1 execute "$DB_NAME" --remote --file=backups/<file>.sql
#
# 推奨運用: CI のスケジューラ（GitHub Actions の cron など）から
# 毎日 1 回実行し、生成ファイルを安全なストレージへ送る。
# D1 自体にも Time Travel (30日) があるので、このスクリプトの
# バックアップはオフサイト保管 + 30日以前への復元のため。

set -euo pipefail

DB_NAME="${DB_NAME:-chosei-kun-db}"
OUTPUT_DIR="${OUTPUT_DIR:-backups}"
mkdir -p "$OUTPUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUTPUT_DIR/${DB_NAME}-${STAMP}.sql"

echo "Exporting $DB_NAME (remote) → $OUT_FILE"
npx wrangler d1 export "$DB_NAME" --remote --output "$OUT_FILE"

echo "Done. Size: $(du -h "$OUT_FILE" | cut -f1)"
