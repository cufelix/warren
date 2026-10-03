#!/usr/bin/env bash
# Pull or plug a VM's network cable: e2e/vms/qmp.sh alice down|up
set -euo pipefail
DIR=${WARREN_VMS:-$HOME/.cache/warren-vms}
up=$([ "$2" = up ] && echo true || echo false)
printf '{"execute":"qmp_capabilities"}\n{"execute":"set_link","arguments":{"name":"nic0","up":%s}}\n' "$up" \
  | timeout 5 socat - UNIX-CONNECT:"$DIR/$1.qmp" > /dev/null
