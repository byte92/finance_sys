import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_APP_CONFIG } from "@/config/defaults";
import type { AppConfig, Stock } from "@/types";

export type StoredPayload = {
  stocks: Stock[];
  config: AppConfig;
};

function normalizePayload(payload: Partial<StoredPayload> | null | undefined): StoredPayload {
  return {
    stocks: payload?.stocks ?? [],
    config: { ...DEFAULT_APP_CONFIG, ...(payload?.config ?? {}) },
  };
}

function ensureDbDir(dbPath: string) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function initSchema(db: Database.Database) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS portfolios (
    user_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `);
}

export function resolveFinanceDbPath() {
  return process.env.FINANCE_SQLITE_PATH || path.join(process.cwd(), "data", "finance.sqlite");
}

export function createPortfolioStore(dbPath = resolveFinanceDbPath()) {
  ensureDbDir(dbPath);
  const db = new Database(dbPath);
  initSchema(db);

  function getPortfolioByUserId(userId: string): StoredPayload {
    const row = db
      .prepare("SELECT payload FROM portfolios WHERE user_id = ?")
      .get(userId) as { payload: string } | undefined;

    if (!row) {
      return { stocks: [], config: DEFAULT_APP_CONFIG };
    }

    try {
      const parsed = JSON.parse(row.payload) as Partial<StoredPayload>;
      return normalizePayload(parsed);
    } catch (error) {
      console.error("Failed to parse SQLite payload:", error);
      return { stocks: [], config: DEFAULT_APP_CONFIG };
    }
  }

  function savePortfolioByUserId(userId: string, payload: StoredPayload) {
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

  function rawInsert(userId: string, payload: string, updatedAt = new Date().toISOString()) {
    db.prepare(
      `
      INSERT INTO portfolios (user_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
      `,
    ).run(userId, payload, updatedAt);
  }

  function close() {
    db.close();
  }

  return {
    dbPath,
    getPortfolioByUserId,
    savePortfolioByUserId,
    rawInsert,
    close,
  };
}

const portfolioStore = createPortfolioStore();

export function getPortfolioByUserId(userId: string): StoredPayload {
  return portfolioStore.getPortfolioByUserId(userId);
}

export function savePortfolioByUserId(userId: string, payload: StoredPayload) {
  portfolioStore.savePortfolioByUserId(userId, payload);
}
