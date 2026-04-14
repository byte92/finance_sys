import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_APP_CONFIG } from "@/config/defaults";
import type { AppConfig, Stock } from "@/types";

type StoredPayload = {
  stocks: Stock[];
  config: AppConfig;
};

const dataDir = path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "finance.sqlite");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

db.exec(`
CREATE TABLE IF NOT EXISTS portfolios (
  user_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

export function getPortfolioByUserId(userId: string): StoredPayload {
  const row = db
    .prepare("SELECT payload FROM portfolios WHERE user_id = ?")
    .get(userId) as { payload: string } | undefined;

  if (!row) {
    return { stocks: [], config: DEFAULT_APP_CONFIG };
  }

  try {
    const parsed = JSON.parse(row.payload) as Partial<StoredPayload>;
    return {
      stocks: parsed.stocks ?? [],
      config: { ...DEFAULT_APP_CONFIG, ...(parsed.config ?? {}) },
    };
  } catch (error) {
    console.error("Failed to parse SQLite payload:", error);
    return { stocks: [], config: DEFAULT_APP_CONFIG };
  }
}

export function savePortfolioByUserId(userId: string, payload: StoredPayload) {
  const now = new Date().toISOString();
  const serialized = JSON.stringify(payload);

  db.prepare(
    `
    INSERT INTO portfolios (user_id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
    `,
  ).run(userId, serialized, now);
}
