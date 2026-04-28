import Fastify from "fastify";
import cors from "@fastify/cors";
import fStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db/sqlite.js";
import { registerAuthRoutes } from "./api/auth-routes.js";
import { registerRoomRoutes } from "./api/rooms.js";
import { registerHudRoutes } from "./api/hud.js";
import { attachWs } from "./ws/gateway.js";
import { subscribe as subscribeTaskBoard } from "./projections/task-board.js";
import { broadcast } from "./room/room-registry.js";
import { seed } from "./scripts/seed-demo-room.js";
import { roomCount } from "./room/room-registry.js";

void db; // ensures schema runs on import

const PORT = Number(process.env.PORT ?? 10000);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

await app.register(cors, {
  origin: true,
  credentials: true,
});

registerAuthRoutes(app);
registerRoomRoutes(app);
registerHudRoutes(app);

app.get("/healthz", async () => ({
  ok: true,
  rooms: roomCount(),
  uptime_s: Math.floor(process.uptime()),
}));

app.get("/readyz", async () => ({ ok: true }));

// Serve the built web app in production. The Dockerfile copies apps/web/dist
// to the runtime image; resolve relative to this file's location at runtime.
const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR_CANDIDATES = [
  resolve(__dirname, "../../web/dist"),
  resolve(__dirname, "../../../web/dist"),
  resolve(process.cwd(), "apps/web/dist"),
];
const webDir = WEB_DIR_CANDIDATES.find((p) => existsSync(p));
if (webDir) {
  await app.register(fStatic, { root: webDir, prefix: "/", wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.url === "/ws") {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.sendFile("index.html");
  });
  app.log.info(`serving web from ${webDir}`);
}

// Bridge task-board projection events to the room broadcast channel.
subscribeTaskBoard((evt) => {
  if (evt.type === "upsert" && evt.task) {
    broadcast(evt.room_id, { t: "task_upserted", task: evt.task });
  }
});

await seed();

await app.listen({ port: PORT, host: HOST });
attachWs(app.server);

app.log.info(`LIGMA server up on :${PORT} (ws path /ws)`);
