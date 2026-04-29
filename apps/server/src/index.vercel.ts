// Vercel-compatible serverless entry point (without WebSockets)
import { config as loadEnv } from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db/sqlite.js";
import { registerAuthRoutes } from "./api/auth-routes.js";
import { registerAiSummaryRoutes } from "./api/ai-summary.js";
import { registerRoomRoutes } from "./api/rooms.js";
import { totalRooms } from "./room/registry.js";
import { seed } from "./scripts/seed-demo-room.js";

void db; // ensure schema runs on import

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

await app.register(cors, { origin: true, credentials: true });

registerAuthRoutes(app);
registerAiSummaryRoutes(app);
registerRoomRoutes(app);

app.get("/healthz", async () => ({
  ok: true,
  rooms: totalRooms(),
  uptime_s: Math.floor(process.uptime()),
  note: "WebSocket endpoint not available on Vercel serverless"
}));

app.get("/health", async () => ({ 
  ok: true, 
  rooms: totalRooms(),
  note: "WebSocket endpoint not available on Vercel serverless"
}));

app.get("/readyz", async () => ({ ok: true }));

// Seed demo data
await seed();

await app.ready();

export default async (req: any, res: any) => {
  await app.ready();
  app.server.emit('request', req, res);
};
