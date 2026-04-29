import Database, { type Database as BetterDB } from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PATH = process.env.SQLITE_PATH ?? join(process.cwd(), "data", "ligma.db");
mkdirSync(dirname(DEFAULT_PATH), { recursive: true });

export const db: BetterDB = new Database(DEFAULT_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");

const schemaPath = join(__dirname, "schema.sql");
const schema = readFileSync(schemaPath, "utf8");
db.exec(schema);

// Lightweight migrations for additive columns.
const eventColumns = new Set(
	db.prepare("PRAGMA table_info(events)").all().map((row) => (row as { name: string }).name),
);
if (!eventColumns.has("shape_json")) {
	db.exec("ALTER TABLE events ADD COLUMN shape_json TEXT");
}
if (!eventColumns.has("cursor_json")) {
	db.exec("ALTER TABLE events ADD COLUMN cursor_json TEXT");
}

export type DB = BetterDB;
