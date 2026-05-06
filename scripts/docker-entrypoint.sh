#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data /app/skills/custom
  chown -R pwuser:pwuser /app/data /app/skills/custom
  exec runuser -u pwuser -- "$@"
fi

exec "$@"
