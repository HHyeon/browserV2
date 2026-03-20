#!/bin/bash

MAX_WORKERS=10
STOP=false

trap 'echo "Stopping..."; STOP=true' SIGINT

run_job() {
  curl -X POST http://192.168.0.101:3002/decode \
    -H "Content-Type: application/json" \
    -d "{\"videoPath\": \"$1\", \"seekTime\": $2}" \
    > /dev/null
}

while true; do
  for file in drvs/drive_5/*.mp4; do
    [ "$STOP" = true ] && break

    SEEK_TIME=$((600 + RANDOM % 600))

    run_job "$file" "$SEEK_TIME" &

    # 🔥 worker 수 제한 (더 안정적)
    if (( $(jobs -r | wc -l) >= MAX_WORKERS )); then
      wait -n
    fi
  done

  [ "$STOP" = true ] && break
done

wait
echo "Shutdown complete"

