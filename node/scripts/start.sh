#!/bin/bash
touch pid
#pnpm run dev:ingress >"logs/ingress.log" 2>&1 &
#  echo $! >>pid
pnpm run dev:pns-daemon >"logs/pns-daemon.log" 2>&1 &
  echo $! >>pid
pnpm run dev:query-service >"logs/query-service.log" 2>&1 &
  echo $! >>pid
pnpm run dev:trajectory-assembler:0 >"logs/trajectory-assembler-0.log" 2>&1 &
  echo $! >>pid
pnpm run dev:trajectory-assembler:1 >"logs/trajectory-assembler-1.log" 2>&1 &
  echo $! >>pid
pnpm run dev:trajectory-assembler:2 >"logs/trajectory-assembler-2.log" 2>&1 &
  echo $! >>pid
pnpm run dev:trajectory-assembler:3 >"logs/trajectory-assembler-3.log" 2>&1 &
  echo $! >>pid
pnpm run dev:distributed-index:0 >"logs/distributed-index-0.log" 2>&1 &
  echo $! >>pid
pnpm run dev:distributed-index:1 >"logs/distributed-index-1.log" 2>&1 &
  echo $! >>pid
pnpm run dev:distributed-index:2 >"logs/distributed-index-2.log" 2>&1 &
  echo $! >>pid
pnpm run dev:distributed-index:3 >"logs/distributed-index-3.log" 2>&1 &
  echo $! >>pid