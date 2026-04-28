import { db } from "../db/sqlite.js";
import { ensureUser } from "../api/auth.js";

const DEMO_ROOM = "rm_demo";
const DEMO_PASSWORD = "demo-password";

interface Seed {
  user_id: string;
  email: string;
  display: string;
  role: "lead" | "contributor" | "viewer";
}

const seeds: Seed[] = [
  { user_id: "u_alice", email: "alice@ligma.dev", display: "Alice", role: "lead" },
  { user_id: "u_bob", email: "bob@ligma.dev", display: "Bob", role: "contributor" },
  { user_id: "u_carol", email: "carol@ligma.dev", display: "Carol", role: "viewer" },
];

export async function seed(): Promise<void> {
  for (const s of seeds) {
    await ensureUser(s.user_id, s.email, s.display, DEMO_PASSWORD);
  }

  const existing = db.prepare("SELECT room_id FROM rooms WHERE room_id = ?").get(DEMO_ROOM);
  if (!existing) {
    db.prepare(
      `INSERT INTO rooms (room_id, name, owner_id, default_role) VALUES (?, ?, ?, ?)`,
    ).run(DEMO_ROOM, "DevDay'26 Demo", seeds[0]!.user_id, "contributor");
  }

  for (const s of seeds) {
    db.prepare(
      `INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(room_id, user_id) DO UPDATE SET role = excluded.role`,
    ).run(DEMO_ROOM, s.user_id, s.role);
  }

  console.log("[seed] demo room ready: rm_demo");
  console.log("[seed]   alice (lead)        u_alice  pw: demo-password");
  console.log("[seed]   bob   (contributor) u_bob    pw: demo-password");
  console.log("[seed]   carol (viewer)      u_carol  pw: demo-password");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
