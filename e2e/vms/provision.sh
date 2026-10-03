#!/usr/bin/env bash
# Installs Node 22, warren-cli (from a packed tarball, like npx would), stub
# codex/cursor-agent and the fake Claude Code host into a VM from up.sh.
#   e2e/vms/provision.sh <ssh-port> <warren-cli.tgz>
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=${WARREN_VMS:-$HOME/.cache/warren-vms}
SSH=(ssh -q -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p "$1" felix@127.0.0.1)
SCP=(scp -q -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -P "$1")
"${SCP[@]}" "$DIR/node.tar.xz" "$2" "$HERE/../devices/laptop/codex" "$HERE/../devices/laptop/fake-claude.mjs" "$HERE/cursor-agent" felix@127.0.0.1:/tmp/
"${SSH[@]}" 'set -e
  sudo tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  sudo npm install -g /tmp/warren-cli-*.tgz --no-audit --no-fund --loglevel=error
  sudo install -m 755 /tmp/codex /tmp/cursor-agent /tmp/fake-claude.mjs /usr/local/bin/
  node --version; warren --version'
