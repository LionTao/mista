#!/bin/bash

if [ -f "pid" ]; then
    while read LINE
    do
      kill -15 $LINE
    done < ./pid
fi
pkill -15 dapr
pkill -15 daprd
pkill -15 python3

pkill -15 ingress
pkill -15 trajectory-assembler
pkill -15 pns-daemon
pkill -15 distributed-index
pkill -15 query-service
pkill -15 mista

rm ./pid