import { config as loadEnv } from "dotenv";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db/sqlite.js";
import { registerAuthRoutes } from "./api/auth-routes.js";
import { registerAiSummaryRoutes } from "./api/ai-summary.js";
import { registerRoomRoutes } from "./api/rooms.js";
import { attachWs } from "./ws/gateway.js";
import { totalRooms } from "./room/registry.js";
import { seed } from "./scripts/seed-demo-room.js";

void db; // ensure schema runs on import

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

const PORT = Number(process.env.PORT ?? 10000);
const HOST = process.env.HOST ?? "0.0.0.0";
const WS_PATH = process.env.LIGMA_SYNC_PATH ?? "/ligma-sync";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

// Allow your frontend domains
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'https://your-vercel-app.vercel.app', // Replace with your actual Vercel URL
];

await app.register(cors, { 
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return cb(null, true);
    if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'), false);
  },
  credentials: true 
});

registerAuthRoutes(app);
registerAiSummaryRoutes(app);
registerRoomRoutes(app);

app.get("/healthz", async () => ({
  ok: true,
  rooms: totalRooms(),
  uptime_s: Math.floor(process.uptime()),
}));

// His client expects /health to return { ok, rooms } too. Keep both alive.
app.get("/health", async () => ({ ok: true, rooms: totalRooms() }));

app.get("/readyz", async () => ({ ok: true }));

// Serve the built web bundle. Resolve relative to runtime location.
const WEB_DIR_CANDIDATES = [
  resolve(__dirname, "../../web/dist"),
  resolve(__dirname, "../../../web/dist"),
  resolve(process.cwd(), "apps/web/dist"),
];
const webDir = WEB_DIR_CANDIDATES.find((p) => existsSync(p));
if (webDir) {
  await app.register(fStatic, { root: webDir, prefix: "/", wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.url === WS_PATH) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.sendFile("index.html");
  });
  app.log.info(`serving web from ${webDir}`);
}

await seed();

await app.listen({ port: PORT, host: HOST });
attachWs(app.server, WS_PATH);
app.log.info(`LIGMA server up on :${PORT} (ws path ${WS_PATH})`);
