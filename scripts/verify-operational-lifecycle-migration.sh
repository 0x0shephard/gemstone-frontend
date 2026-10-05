#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="postgres:16-alpine"
container="dc-operational-migration-$RANDOM-$$"
password="disposable-only"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the disposable PostgreSQL check." >&2
  exit 1
fi
if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "Missing local image $image; this script will not download it automatically." >&2
  exit 1
fi

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --name "$container" \
  --env POSTGRES_PASSWORD="$password" \
  --tmpfs /var/lib/postgresql/data \
  "$image" >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
docker exec "$container" pg_isready -U postgres -d postgres >/dev/null

psql_file() {
  local file="$1"
  docker exec --interactive "$container" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$file" >/dev/null
}

psql_file "$repo_dir/scripts/sql/operational-lifecycle-bootstrap.sql"
psql_file "$repo_dir/supabase/schema.sql"
# schema.sql creates the legacy public tables; now add the compatibility columns
# expected by the first ordered migration.
psql_file "$repo_dir/scripts/sql/operational-lifecycle-bootstrap.sql"

while IFS= read -r migration; do
  echo "Applying $(basename "$migration")"
  psql_file "$migration"
done < <(find "$repo_dir/supabase/migrations" -maxdepth 1 -type f -name '*.sql' | sort)

docker exec --interactive "$container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$repo_dir/scripts/sql/operational-lifecycle-behavior.sql"
