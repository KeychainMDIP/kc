#!/bin/bash

# Change this if your service name is different
SERVICE_NAME="ipfs"

# Function to run a command inside the container
ipfs_exec() {
  docker compose exec -T "$SERVICE_NAME" ipfs "$@"
}

echo "🔧 Updating Swarm.ConnMgr settings..."
ipfs_exec config --json Swarm.ConnMgr '{
  "HighWater": 200,
  "LowWater": 100,
  "GracePeriod": "300s",
  "Type": "basic"
}'

echo "🔧 Disabling NAT port mapping..."
ipfs_exec config --bool Swarm.DisableNatPortMap true

echo "🔧 Enabling AutoNAT service..."
ipfs_exec config --bool Swarm.EnableAutoNATService true

echo "🔧 Disabling Relay client and service..."
ipfs_exec config --bool Swarm.RelayClient.Enabled false
ipfs_exec config --bool Swarm.RelayService.Enabled false

echo "🔧 Setting Routing.Type to dht..."
ipfs_exec config Routing.Type dht

# Confirm PeerID
PEER_ID=$(ipfs_exec config Identity.PeerID)
echo "✅ Config updated for PeerID: $PEER_ID"
