#!/bin/bash
pkill -f "next start"; pkill -f "next-server"; sleep 1
for i in $(seq 1 20); do curl -s -o /dev/null http://localhost:3000/ || break; sleep 0.5; done
export BETTER_AUTH_SECRET=$(cat /tmp/secret.txt) DATABASE_URL=postgresql://postgres@127.0.0.1:5432/meetready_e2e BETTER_AUTH_URL=http://localhost:3000 GOOGLE_CLIENT_ID=dummy GOOGLE_CLIENT_SECRET=dummy
cd /home/claude/e2e && node seed-pg.mjs || exit 1
cd /home/claude/meetready && (DEMO_BOOKING_PATH=/sakif/intro npx next start -p 3000 > /tmp/next.log 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null http://localhost:3000/ && break; sleep 0.5; done
grep -q EADDRINUSE /tmp/next.log && echo "PORT CLASH" || echo "fresh db + server up"
