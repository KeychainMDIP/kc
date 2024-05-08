#!/usr/bin/env sh
docker compose -f dc-btc.yml build
docker compose -f dc-btc.yml up -d
