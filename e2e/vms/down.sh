#!/usr/bin/env bash
# Stops the VMs started by up.sh and deletes their disks (base.img is kept).
DIR=${WARREN_VMS:-$HOME/.cache/warren-vms}
cd "$DIR" || exit 0
for pid in *.pid; do [ -f "$pid" ] || continue; kill "$(cat "$pid")" 2>/dev/null; rm -f "$pid" "${pid%.pid}".{qcow2,qmp} "${pid%.pid}"-{seed.iso,user-data,meta-data}; done
