#!/usr/bin/env bash
# Deploys (or resets) the test hub on a VPS over ssh: builds this checkout there
# and runs it as container warren-test-hub on port 8790 with a fresh database.
#   e2e/vms/hub.sh <ssh-host> <join-code> [deploy|reset|down]
set -euo pipefail
HOST=$1; CODE=$2; ACTION=${3:-deploy}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
IP=$(ssh "$HOST" "hostname -I | cut -d' ' -f1")
if [ "$ACTION" = deploy ]; then
  tar czf /tmp/warren-src.tgz -C "$ROOT" --exclude=node_modules --exclude=.git --exclude='*/dist' .
  scp -q /tmp/warren-src.tgz "$HOST":/tmp/warren-src.tgz
  ssh "$HOST" 'rm -rf ~/warren-test && mkdir -p ~/warren-test && tar xzf /tmp/warren-src.tgz -C ~/warren-test && cd ~/warren-test && docker build -q -t warren-test-hub . > /dev/null'
fi
ssh "$HOST" "docker rm -f warren-test-hub > /dev/null 2>&1; docker volume rm warren-test-data > /dev/null 2>&1; true"
[ "$ACTION" = down ] && { ssh "$HOST" "docker rmi warren-test-hub > /dev/null 2>&1; rm -rf ~/warren-test /tmp/warren-src.tgz"; echo "removed"; exit 0; }
ssh "$HOST" "docker run -d --name warren-test-hub --restart unless-stopped -p 8790:3000 -v warren-test-data:/data \
  -e WARREN_DEMO=0 -e WARREN_TEAM=junction -e WARREN_JOIN_CODE=$CODE -e PUBLIC_URL=http://$IP:8790 warren-test-hub > /dev/null"
echo "hub: http://$IP:8790  join: http://$IP:8790/join/$CODE"
