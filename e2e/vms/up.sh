#!/usr/bin/env bash
# Boots "laptop" VMs for the real end-to-end test: Ubuntu 24.04 cloud image,
# own kernel, clock and NIC under KVM, no root needed (user networking).
#
#   e2e/vms/up.sh alice:2221 bob:2222
#
# SSH: ssh -p <port> felix@127.0.0.1. Each VM has a QMP socket for pulling
# its network cable (see qmp.sh). Images and state live in $WARREN_VMS
# (default ~/.cache/warren-vms); base.img is downloaded once.
set -euo pipefail
DIR=${WARREN_VMS:-$HOME/.cache/warren-vms}
mkdir -p "$DIR" && cd "$DIR"
[ -f base.img ] || curl -fL -o base.img https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
[ -f node.tar.xz ] || curl -fL -o node.tar.xz https://nodejs.org/dist/v22.19.0/node-v22.19.0-linux-x64.tar.xz
KEY=$(cat "$HOME/.ssh/id_ed25519.pub")

for spec in "$@"; do
  name=${spec%%:*}; port=${spec##*:}
  [ -f "$name.pid" ] && kill -0 "$(cat "$name.pid")" 2>/dev/null && { echo "$name already running"; continue; }
  rm -f "$name.qcow2" "$name-seed.iso" "$name.qmp"
  qemu-img create -q -f qcow2 -b base.img -F qcow2 "$name.qcow2" 10G
  cat > "$name-user-data" <<UD
#cloud-config
hostname: laptop-$name
users:
  - name: felix
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys: [$KEY]
package_update: false
UD
  printf 'instance-id: %s\nlocal-hostname: laptop-%s\n' "$name" "$name" > "$name-meta-data"
  cloud-localds "$name-seed.iso" "$name-user-data" "$name-meta-data"
  qemu-system-x86_64 -enable-kvm -cpu host -smp 1 -m 1536 -name "$name" \
    -drive file="$name.qcow2",if=virtio -drive file="$name-seed.iso",if=virtio,format=raw \
    -netdev user,id=n0,hostfwd=tcp:127.0.0.1:"$port"-:22 -device virtio-net-pci,netdev=n0,id=nic0 \
    -qmp unix:"$DIR/$name.qmp",server,nowait \
    -display none -daemonize -pidfile "$name.pid"
  echo "$name booting, ssh -p $port felix@127.0.0.1"
done
