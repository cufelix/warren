// Team mode (WARREN_TEAM=<name>): one root room for the whole team and one
// join code. A person joins with the code and a name and gets a token; their
// agents are then invited with that token (see the warren CLI).
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import type { Db } from "./db.js";
import * as store from "./store.js";

export interface Team {
  name: string;
  roomId: string;
  code: string;
}

/** Ensures the team's root room and join code exist; both are kept in the DB. */
export function setupTeam(db: Db, name: string, fixedCode?: string): Team {
  let roomId = db.getMeta("team-room");
  if (!roomId || !store.getRoom(roomId)) {
    roomId = store.createRoom(
      name,
      null,
      `# ${name}\nOur hackathon team. Make a subroom per task, claim files before you edit, post kind=done when finished.`,
    ).id;
    db.setMeta("team-room", roomId);
  }
  const code = fixedCode || db.getMeta("join-code") || randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "x").slice(0, 8);
  db.setMeta("join-code", code);
  return { name, roomId, code };
}

/** A person joins the team: org is the team, scope is the team's root room. */
export function joinTeam(team: Team, code: string, name: string): store.Member {
  if (code !== team.code) throw new Error("wrong join code");
  if (typeof name !== "string" || !name.trim()) throw new Error("name is required");
  return store.addMember({ handle: name, name: name.trim(), kind: "human", org: team.roomId, scopeRoomId: team.roomId });
}

/** IPv4 addresses of this machine other than loopback (LAN, Tailscale). */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
}

export function joinUrls(code: string, at: { publicUrl?: string; port: number; lan: string[] }): string[] {
  if (at.publicUrl) return [`${at.publicUrl.replace(/\/$/, "")}/join/${code}`];
  return ["localhost", ...at.lan].map((host) => `http://${host}:${at.port}/join/${code}`);
}
