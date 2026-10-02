// SQLite persistence for the hub, so a restart in the middle of a hackathon
// loses nothing. The store stays in memory; this module loads it on start and
// writes every change through by listening to the store's events.
//
//   WARREN_DB=<file>   default $WARREN_DATA_DIR/warren.db; ":memory:" keeps nothing
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as store from "./store.js";

export interface Db {
  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
  /** True when nothing was loaded: no rooms or members yet. */
  isEmpty(): boolean;
  close(): void;
}

export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members (handle TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, room_id TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  load(db);

  const saveRoom = db.prepare("INSERT INTO rooms (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json");
  const saveMember = db.prepare("INSERT INTO members (handle, json) VALUES (?, ?) ON CONFLICT(handle) DO UPDATE SET json = excluded.json");
  const dropMember = db.prepare("DELETE FROM members WHERE handle = ?");
  // Upsert keeps the row's seq, so a reviewed message stays in its place.
  const saveMessage = db.prepare(
    "INSERT INTO messages (id, room_id, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
  );
  const saveAudit = db.prepare("INSERT OR IGNORE INTO audit (id, json) VALUES (?, ?)");

  const offs: (() => void)[] = [];
  // A failed write is logged, never thrown: it must not stop the other listeners (SSE delivery).
  const on = <T>(event: string, fn: (payload: T) => void) => {
    const safe = (payload: T) => {
      try {
        fn(payload);
      } catch (e) {
        console.error(`warren db: saving ${event} failed: ${(e as Error).message}`);
      }
    };
    store.events.on(event, safe);
    offs.push(() => store.events.off(event, safe));
  };
  on<store.Room>("room", (r) => saveRoom.run(r.id, JSON.stringify({ ...r, messages: [] })));
  on<store.PublicMember>("member", (pm) => {
    const m = store.getMember(pm.handle); // the event carries no token
    if (m) saveMember.run(m.handle, JSON.stringify(m));
  });
  on<string>("member_removed", (handle) => dropMember.run(handle));
  on<store.Message>("message", (m) => saveMessage.run(m.id, m.roomId, JSON.stringify(m)));
  on<store.Message>("message_update", (m) => saveMessage.run(m.id, m.roomId, JSON.stringify(m)));
  on<store.AuditEvent>("audit", (e) => saveAudit.run(e.id, JSON.stringify(e)));

  const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const setMeta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  return {
    getMeta: (key) => (getMeta.get(key) as { value: string } | undefined)?.value,
    setMeta: (key, value) => void setMeta.run(key, value),
    isEmpty: () => store.allRooms().length === 0 && store.allMembers().length === 0,
    close() {
      for (const off of offs) off();
      db.close();
    },
  };
}

function load(db: DatabaseSync) {
  const rows = (sql: string) => (db.prepare(sql).all() as { json: string }[]).map((r) => JSON.parse(r.json));
  const rooms: store.Room[] = rows("SELECT json FROM rooms");
  const byId = new Map(rooms.map((r) => [r.id, { ...r, messages: [] as store.Message[] }]));
  for (const m of rows("SELECT json FROM messages ORDER BY seq") as store.Message[]) byId.get(m.roomId)?.messages.push(m);
  store.hydrate({
    rooms: [...byId.values()],
    members: rows("SELECT json FROM members"),
    audit: rows("SELECT json FROM audit ORDER BY seq"),
  });
}
