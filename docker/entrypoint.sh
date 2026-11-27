#!/bin/sh
set -e

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "RUN_MIGRATIONS=true: aplicando migrations antes de subir a API"
  node dist/cli/migrate.js
fi

exec "$@"
