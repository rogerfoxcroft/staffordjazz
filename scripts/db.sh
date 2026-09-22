#!/bin/sh
# Starts a throwaway MariaDB container holding the WordPress dump, for scripts/export.mjs.
# Usage: scripts/db.sh [path-to-dump.sql]
set -e
DUMP="${1:-if0_40314777_staffordjazz.sql}"
docker rm -f sj-db >/dev/null 2>&1 || true
docker run -d --name sj-db -p 127.0.0.1:3307:3306 \
  -e MARIADB_ROOT_PASSWORD=root -e MARIADB_DATABASE=sj mariadb:11.4 >/dev/null
printf 'Waiting for MariaDB'
until docker exec sj-db mariadb -uroot -proot -e 'select 1' >/dev/null 2>&1; do printf .; sleep 2; done
echo
docker exec -i sj-db mariadb -uroot -proot sj < "$DUMP"
echo "Loaded $DUMP into sj-db (127.0.0.1:3307, root/root, database sj)"
