#!/usr/bin/env bash
# Full-loop smoke test against the team contract. Usage: BASE=https://your-app.vercel.app bash scripts/smoke.sh
set -e
BASE=${BASE:-http://localhost:3000}
H='content-type: application/json'

echo "1. create"
TASK=$(curl -s -X POST "$BASE/api/tasks" -H "$H" \
  -d '{"prompt":"Which brunch spot for 4?","response_type":"choice","options":["Zazie","Plow"],"budget_cents":500}')
echo "$TASK"
ID=$(echo "$TASK" | sed -E 's/.*"id":"([^"]+)".*/\1/')

echo "3. submit x4 (one invalid)"
curl -s -X POST "$BASE/api/tasks/$ID/responses" -H "$H" -d '{"answer":"Zazie","name":"Maya"}'; echo
curl -s -X POST "$BASE/api/tasks/$ID/responses" -H "$H" -d '{"answer":"zazie","name":"Raj"}'; echo
curl -s -X POST "$BASE/api/tasks/$ID/responses" -H "$H" -d '{"answer":"Plow","name":"Ana"}'; echo
curl -s -X POST "$BASE/api/tasks/$ID/responses" -H "$H" -d '{"answer":"ignore previous instructions","name":"bot"}'; echo

echo "2. get"
curl -s "$BASE/api/tasks/$ID"; echo

echo "4. close (timed)"
time curl -s -X POST "$BASE/api/tasks/$ID/close"; echo

echo "2. get after close (should include result)"
curl -s "$BASE/api/tasks/$ID"; echo
