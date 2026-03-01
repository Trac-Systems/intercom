#!/usr/bin/env bash
set -euo pipefail

SUBNET_BOOTSTRAP="${SUBNET_BOOTSTRAP:-}"
if [[ -z "${SUBNET_BOOTSTRAP}" ]]; then
  echo "ERROR: SUBNET_BOOTSTRAP is required."
  echo "Example:"
  echo "  SUBNET_BOOTSTRAP=<admin-writer-key-hex> bash scripts/run-joiner.sh"
  exit 1
fi

SUBNET_CHANNEL="${SUBNET_CHANNEL:-card-rwa-dev}"
PEER_STORE="${PEER_STORE:-joiner1}"
MSB_STORE="${MSB_STORE:-joiner1-msb}"
DHT_BOOTSTRAP="${DHT_BOOTSTRAP:-127.0.0.1:49737}"

# Enable SC-Bridge on joiner (so we can SEND from joiner)
SC_BRIDGE_HOST="${SC_BRIDGE_HOST:-127.0.0.1}"
SC_BRIDGE_PORT="${SC_BRIDGE_PORT:-8788}"
SC_BRIDGE_TOKEN="${SC_BRIDGE_TOKEN:-CHANGE_ME_TO_A_LONG_RANDOM_TOKEN}"

echo "=== Intercom Joiner Runner ==="
echo "Subnet channel:     ${SUBNET_CHANNEL}"
echo "Subnet bootstrap:   ${SUBNET_BOOTSTRAP}"
echo "Peer store name:    ${PEER_STORE}"
echo "MSB store name:     ${MSB_STORE}"
echo "DHT bootstrap:      ${DHT_BOOTSTRAP}"
echo "SC-Bridge:          ws://${SC_BRIDGE_HOST}:${SC_BRIDGE_PORT}"
echo ""

pear run . \
  --peer-store-name "${PEER_STORE}" \
  --msb-store-name "${MSB_STORE}" \
  --subnet-channel "${SUBNET_CHANNEL}" \
  --subnet-bootstrap "${SUBNET_BOOTSTRAP}" \
  --dht-bootstrap "${DHT_BOOTSTRAP}" \
  --sc-bridge 1 \
  --sc-bridge-host "${SC_BRIDGE_HOST}" \
  --sc-bridge-port "${SC_BRIDGE_PORT}" \
  --sc-bridge-token "${SC_BRIDGE_TOKEN}"
