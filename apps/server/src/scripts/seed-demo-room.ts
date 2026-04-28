import { db } from "../db/sqlite.js";
import { ensureUser } from "../api/auth.js";

const DEMO_ROOM = "ligma-devday-main";
const DEMO_PASSWORD = "demo-password";

interface Seed {
  user_id: string;
  email: string;
  display: string;
  role: "Lead" | "Contributor" | "Viewer";
}

const seeds: Seed[] = [
  { user_id: "u_alice", email: "alice@ligma.dev", display: "Alice", role: "Lead" },
  { user_id: "u_bob", email: "bob@ligma.dev", display: "Bob", role: "Contributor" },
  { user_id: "u_carol", email: "carol@ligma.dev", display: "Carol", role: "Viewer" },
];

export async function seed(): Promise<void> {
  for (const s of seeds) {
    await ensureUser(s.user_id, s.email, s.display, DEMO_PASSWORD);
  }

  const existing = db.prepare("SELECT room_id FROM rooms WHERE room_id = ?").get(DEMO_ROOM);
  if (!existing) {
    db.prepare(
      `INSERT INTO rooms (room_id, name, owner_id, default_role) VALUES (?, ?, ?, ?)`,
    ).run(DEMO_ROOM, "DevDay'26 Demo", seeds[0]!.user_id, "Contributor");
  }

  for (const s of seeds) {
    db.prepare(
      `INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(room_id, user_id) DO UPDATE SET role = excluded.role`,
    ).run(DEMO_ROOM, s.user_id, s.role);
  }

  console.log("[seed] demo room ready: ligma-devday-main");
  console.log("[seed]   alice (Lead)        u_alice  pw: demo-password");
  console.log("[seed]   bob   (Contributor) u_bob    pw: demo-password");
  console.log("[seed]   carol (Viewer)      u_carol  pw: demo-password");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
