#!/usr/bin/env bash
# Live video task, end to end without cameras: create -> 3 volunteers -> pick -> "started" -> end & pay.
# Usage: BASE=https://dryrun-oct3-oct2.vercel.app bash scripts/live-smoke.sh
# For the real thing, open the printed watch URL on a laptop and scan its QR with phones.
set -e
BASE=${BASE:-http://localhost:3000}
H='content-type: application/json'

echo "1. create live task"
TASK=$(curl -s -X POST "$BASE/api/tasks" -H "$H" \
  -d '{"prompt":"Show me around the SF State campus: main quad, library, student center","response_type":"live","budget_cents":2000}')
echo "$TASK"
ID=$(echo "$TASK" | sed -E 's/.*"id":"([^"]+)".*/\1/')
echo "   watch:     $BASE/live/$ID"
echo "   volunteer: $BASE/live/$ID/go"

echo "2. three volunteers (same device twice -> same claim)"
for who in Maya Raj Ana; do
  curl -s -X POST "$BASE/api/tasks/$ID/live" -H "$H" -d "{\"action\":\"claim\",\"name\":\"$who\",\"device_id\":\"smoke-$who\"}"; echo
done
curl -s -X POST "$BASE/api/tasks/$ID/live" -H "$H" -d '{"action":"claim","name":"Maya","device_id":"smoke-Maya"}'; echo

echo "3. pick now (normally automatic 15s after the first volunteer)"
LIVE=$(curl -s -X POST "$BASE/api/tasks/$ID/live" -H "$H" -d '{"action":"assign"}')
echo "$LIVE"
CLAIM=$(echo "$LIVE" | sed -E 's/.*"assigned":\{"claim_id":"([^"]+)".*/\1/')

echo "4. picked phone reports camera started, streams 3s"
curl -s -X POST "$BASE/api/tasks/$ID/live" -H "$H" -d "{\"action\":\"started\",\"claim_id\":\"$CLAIM\"}"; echo
sleep 3

echo "5. end & pay (full budget to the one streamer)"
curl -s -X POST "$BASE/api/tasks/$ID/close"; echo
