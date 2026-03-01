#!/usr/bin/env bash
set -euo pipefail

SUBNET_CHANNEL="${SUBNET_CHANNEL:-card-rwa-dev}"
PEER_STORE="${PEER_STORE:-admin}"
MSB_STORE="${MSB_STORE:-admin-msb}"
DHT_BOOTSTRAP="${DHT_BOOTSTRAP:-127.0.0.1:49737}"

SC_BRIDGE_HOST="${SC_BRIDGE_HOST:-127.0.0.1}"
SC_BRIDGE_PORT="${SC_BRIDGE_PORT:-8787}"
SC_BRIDGE_TOKEN="${SC_BRIDGE_TOKEN:-CHANGE_ME_TO_A_LONG_RANDOM_TOKEN}"

echo "=== Intercom Admin Runner ==="
echo "Subnet channel:      ${SUBNET_CHANNEL}"
echo "Peer store name:     ${PEER_STORE}"
echo "MSB store name:      ${MSB_STORE}"
echo "DHT bootstrap:       ${DHT_BOOTSTRAP}"
echo "SC-Bridge endpoint:  ws://${SC_BRIDGE_HOST}:${SC_BRIDGE_PORT}"
echo "SC-Bridge token set: ${SC_BRIDGE_TOKEN}"
echo ""
echo "DEV MODE: sidechannel welcome requirement is DISABLED"
echo ""

pear run . \
  --peer-store-name "${PEER_STORE}" \
  --msb-store-name "${MSB_STORE}" \
  --subnet-channel "${SUBNET_CHANNEL}" \
  --dht-bootstrap "${DHT_BOOTSTRAP}" \
  --sidechannel-welcome-required 0 \
  --sc-bridge 1 \
  --sc-bridge-host "${SC_BRIDGE_HOST}" \
  --sc-bridge-port "${SC_BRIDGE_PORT}" \
  --sc-bridge-token "${SC_BRIDGE_TOKEN}"
