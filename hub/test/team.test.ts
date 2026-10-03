// Team mode: one root room, one join code, people join by name.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as store from "../src/store.js";
import { openDb } from "../src/db.js";
import { joinTeam, joinUrls, setupTeam } from "../src/team.js";

let file: string;
beforeEach(() => {
  store.reset();
  file = join(mkdtempSync(join(tmpdir(), "warren-team-")), "warren.db");
});

test("setupTeam creates the root room and a join code once", () => {
  const db = openDb(file);
  const first = setupTeam(db, "Junction Crew");
  assert.equal(first.roomId, "junction-crew");
  assert.match(first.code, /^[a-z0-9]{8}$/);
  const again = setupTeam(db, "Junction Crew");
  assert.deepEqual(again, first);
  assert.equal(store.allRooms().length, 1);
  db.close();
});

test("the join code survives a restart", () => {
  const db = openDb(file);
  const { code } = setupTeam(db, "crew");
  db.close();
  store.reset();
  const db2 = openDb(file);
  assert.equal(setupTeam(db2, "crew").code, code);
  db2.close();
});

test("a fixed code from the environment wins", () => {
  const db = openDb(file);
  assert.equal(setupTeam(db, "crew", "letmein").code, "letmein");
  db.close();
});

test("joinTeam creates a person in the team's org and root room", () => {
  const db = openDb(file);
  const team = setupTeam(db, "crew");
  const p = joinTeam(team, team.code, "Felix");
  assert.equal(p.handle, "felix");
  assert.equal(p.kind, "human");
  assert.equal(p.org, "crew");
  assert.equal(p.scopeRoomId, "crew");
  assert.match(p.token, /^wr_/);
  db.close();
});

test("joinTeam refuses a wrong code and an empty name", () => {
  const db = openDb(file);
  const team = setupTeam(db, "crew");
  assert.throws(() => joinTeam(team, "nope", "felix"), /join code/);
  assert.throws(() => joinTeam(team, team.code, "  "), /name/);
  db.close();
});

test("joining again with the same name (a second laptop) returns the same person", () => {
  const db = openDb(file);
  const team = setupTeam(db, "crew");
  const first = joinTeam(team, team.code, "felix");
  const again = joinTeam(team, team.code, "Felix");
  assert.equal(again.token, first.token);
  assert.equal(store.allMembers().length, 1);
  db.close();
});

test("a name held by an agent can't be joined as a person", () => {
  const db = openDb(file);
  const team = setupTeam(db, "crew");
  store.addMember({ handle: "claude-x", name: "c", org: "crew", scopeRoomId: "crew" });
  assert.throws(() => joinTeam(team, team.code, "claude-x"), /taken/);
  db.close();
});

test("joinUrls lists the public url, or localhost and LAN addresses", () => {
  assert.deepEqual(joinUrls("abc", { publicUrl: "https://hub.example", port: 1, lan: ["10.0.0.2"] }), ["https://hub.example/join/abc"]);
  assert.deepEqual(joinUrls("abc", { port: 8790, lan: ["10.0.0.2", "100.64.1.2"] }), [
    "http://localhost:8790/join/abc",
    "http://10.0.0.2:8790/join/abc",
    "http://100.64.1.2:8790/join/abc",
  ]);
});
