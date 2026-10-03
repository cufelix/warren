#!/usr/bin/env -S npx tsx
// warren-bridge entry for running from a checkout (`npx tsx bridge/src/index.ts`).
// The installed CLI runs the same bridge as `warren bridge`.
import { runBridge } from "./bridge.js";

await runBridge();
