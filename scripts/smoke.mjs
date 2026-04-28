// End-to-end smoke test:
// 1. Get JWTs for alice (lead), bob (contributor), carol (viewer).
// 2. Connect each as a WS client.
// 3. Alice creates a node — verify it appears for everyone.
// 4. Bob moves it — verify Alice sees the update.
// 5. Carol tries to move it — verify rbac_denied.
// 6. Quick replay: GET /api/rooms/rm_demo/events and verify event log.

import { setTimeout as sleep } from "node:timers/promises";
// WebSocket is available globally in Node 22+; fall back to ws if needed.
let _WS = globalThis.WebSocket;
if (!_WS) {
  _WS = (await import("ws")).default;
}
const WSCtor = _WS;

const BASE = process.env.BASE ?? "http://localhost:10001";
const WSURL = BASE.replace("http", "ws") + "/ws";

async function token(user_id) {
  const r = await fetch(`${BASE}/api/auth/dev-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user_id }),
  });
  if (!r.ok) throw new Error(`token: ${r.status}`);
  const data = await r.json();
  return data.token;
}

function connect(token, room) {
  return new Promise((resolve, reject) => {
    const ws = new WSCtor(`${WSURL}?room=${room}&token=${token}`);
    if (typeof ws.on === "function") {
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    } else {
      ws.addEventListener("open", () => resolve(ws));
      ws.addEventListener("error", reject);
    }
  });
}

function onMessage(ws, fn) {
  if (typeof ws.on === "function") ws.on("message", (raw) => fn(String(raw)));
  else ws.addEventListener("message", (e) => fn(typeof e.data === "string" ? e.data : String(e.data)));
}

function listen(ws, label) {
  onMessage(ws, (raw) => {
    const m = JSON.parse(raw);
    if (m.t === "op") {
      console.log(`[${label}] op seq=${m.event.seq} kind=${m.event.kind} actor=${m.event.actor_id}`);
    } else if (m.t === "rbac_denied") {
      console.log(`[${label}] RBAC DENIED: ${m.reason} (${m.kind})`);
    } else if (m.t === "hello_ok") {
      console.log(`[${label}] hello_ok role=${m.role} seq_max=${m.seq_max}`);
    } else if (m.t === "ack") {
      console.log(`[${label}] ack ref=${m.ref_id} seq=${m.seq}`);
    } else if (m.t === "task_upserted") {
      console.log(`[${label}] task_upserted ${m.task.title}`);
    }
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

async function main() {
  const ROOM = "rm_demo";

  console.log("=== fetching tokens ===");
  const aliceTok = await token("u_alice");
  const bobTok = await token("u_bob");
  const carolTok = await token("u_carol");

  console.log("=== connecting ===");
  const alice = await connect(aliceTok, ROOM);
  const bob = await connect(bobTok, ROOM);
  const carol = await connect(carolTok, ROOM);
  listen(alice, "alice");
  listen(bob, "bob");
  listen(carol, "carol");

  send(alice, { t: "hello", id: "h1", room: ROOM, last_applied_seq: 0 });
  send(bob, { t: "hello", id: "h2", room: ROOM, last_applied_seq: 0 });
  send(carol, { t: "hello", id: "h3", room: ROOM, last_applied_seq: 0 });
  await sleep(300);

  console.log("=== alice (lead) creates a node ===");
  const NODE = "n_smoke_1";
  send(alice, {
    t: "op",
    id: "op-create-1",
    kind: "node.created",
    node_id: NODE,
    payload: { kind: "sticky", x: 100, y: 100, w: 200, h: 140, fill: "#fde68a", text: "" },
    lamport: 1,
    client_ts: Date.now(),
  });
  await sleep(300);

  console.log("=== bob (contributor) moves the node ===");
  send(bob, {
    t: "op",
    id: "op-move-1",
    kind: "node.moved",
    node_id: NODE,
    payload: { x: 250, y: 200 },
    lamport: 2,
    client_ts: Date.now(),
  });
  await sleep(300);

  console.log("=== carol (viewer) tries to move the node — must be denied ===");
  send(carol, {
    t: "op",
    id: "op-move-by-viewer",
    kind: "node.moved",
    node_id: NODE,
    payload: { x: 999, y: 999 },
    lamport: 3,
    client_ts: Date.now(),
  });
  await sleep(300);

  console.log("=== carol (viewer) tries to grant herself lead — must be denied ===");
  send(carol, {
    t: "op",
    id: "op-priv-by-viewer",
    kind: "permission.granted",
    node_id: NODE,
    payload: { user_id: "u_carol", role: "lead" },
    lamport: 4,
    client_ts: Date.now(),
  });
  await sleep(300);

  console.log("=== alice emits AI intent label ===");
  send(alice, {
    t: "op",
    id: "op-intent-1",
    kind: "intent.labeled",
    node_id: NODE,
    payload: { label: "action item", score: 0.91 },
    lamport: 5,
    client_ts: Date.now(),
  });
  await sleep(300);

  console.log("=== fetching event log ===");
  const r = await fetch(`${BASE}/api/rooms/${ROOM}/events`, {
    headers: { authorization: `Bearer ${aliceTok}` },
  });
  const events = await r.json();
  console.log(`  total events: ${events.events.length}`);
  for (const e of events.events.slice(-6)) {
    console.log(`    seq=${e.seq} kind=${e.kind} actor=${e.actor_id} lamport=${e.lamport}`);
  }

  console.log("=== fetching tasks ===");
  const tr = await fetch(`${BASE}/api/rooms/${ROOM}/tasks`, {
    headers: { authorization: `Bearer ${aliceTok}` },
  });
  const tasks = await tr.json();
  console.log(`  tasks: ${tasks.length}`);
  for (const t of tasks) {
    console.log(`    ${t.task_id}: "${t.title}" score=${t.ai_score} seq=${t.updated_seq}`);
  }

  console.log("=== HUD denials ===");
  const dr = await fetch(`${BASE}/api/hud/denials?room=${ROOM}`, {
    headers: { authorization: `Bearer ${aliceTok}` },
  });
  const dn = await dr.json();
  console.log(`  denials buffered: ${dn.denials.length}`);
  for (const d of dn.denials) {
    console.log(`    ${d.user_id} ${d.kind}: ${d.reason}`);
  }

  alice.close();
  bob.close();
  carol.close();
  await sleep(100);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
