#!/bin/bash
# ==============================================================
# Восстановление БД из бэкапа (аварийный режим, без Express)
# ==============================================================
# Использование:
#   ./restore.sh                    — восстановить из последнего бэкапа
#   ./restore.sh backup_2026-05-14_15-30-00.sql — из конкретного файла
# ==============================================================

set -e

CONTAINER="projects_postgres_18"
DB_USER="admin"
DB_NAME="b2b_portal"
BACKUP_DIR="backups"

cd "$(dirname "$0")"

# Проверка Docker
if ! docker ps &>/dev/null; then
  echo "❌ Docker не запущен. Запустите Docker Desktop."
  exit 1
fi

# Проверка контейнера
if ! docker ps --filter "name=$CONTAINER" --format "{{.Names}}" | grep -q "$CONTAINER"; then
  echo "❌ Контейнер $CONTAINER не запущен."
  echo "   Запустите: docker compose up -d db"
  exit 1
fi

# Выбор файла
if [ -n "$1" ]; then
  FILE="$1"
else
  FILE=$(ls -t "$BACKUP_DIR"/backup_*.sql 2>/dev/null | head -1)
fi

if [ -z "$FILE" ]; then
  echo "❌ Файл бэкапа не найден в $BACKUP_DIR/"
  echo "   Положите .sql файл в папку $BACKUP_DIR/ и запустите:"
  echo "   ./restore.sh ваш_файл.sql"
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "❌ Файл не найден: $FILE"
  exit 1
fi

SIZE=$(du -h "$FILE" | cut -f1)
echo "📦 Бэкап: $FILE ($SIZE)"
echo "⚠️  Будет восстановлена база $DB_NAME в контейнере $CONTAINER"
echo "   Все текущие данные будут заменены!"
echo ""
read -p "Продолжить? (y/N) " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "❌ Отменено"
  exit 0
fi

echo "🔄 Восстановление..."
START=$(date +%s)

docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$FILE"

END=$(date +%s)
DURATION=$((END - START))
echo "✅ Восстановление завершено за ${DURATION}с"
