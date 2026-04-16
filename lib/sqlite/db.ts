import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_AI_PROMPT_TEMPLATES, DEFAULT_APP_CONFIG } from "@/config/defaults";
import type { AiAnalysisHistoryRecord, AiAnalysisResult, AppConfig, Market, Stock } from "@/types";

export type StoredPayload = {
  stocks: Stock[];
  config: AppConfig;
};

function normalizePayload(payload: Partial<StoredPayload> | null | undefined): StoredPayload {
  return {
    stocks: payload?.stocks ?? [],
    config: {
      ...DEFAULT_APP_CONFIG,
      ...(payload?.config ?? {}),
      feeConfigs: {
        ...DEFAULT_APP_CONFIG.feeConfigs,
        ...(payload?.config?.feeConfigs ?? {}),
      },
      aiConfig: {
        ...DEFAULT_APP_CONFIG.aiConfig,
        ...(payload?.config?.aiConfig ?? {}),
        promptTemplates: {
          ...DEFAULT_AI_PROMPT_TEMPLATES,
          ...(payload?.config?.aiConfig?.promptTemplates ?? {}),
        },
      },
      currency: {
        ...DEFAULT_APP_CONFIG.currency,
        ...(payload?.config?.currency ?? {}),
      },
    },
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

  CREATE TABLE IF NOT EXISTS ai_analysis_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    analysis_type TEXT NOT NULL,
    stock_id TEXT,
    stock_code TEXT,
    stock_name TEXT,
    market TEXT,
    confidence TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `);
}

type SaveAiAnalysisInput = Omit<AiAnalysisHistoryRecord, "createdAt">;

type ListAiAnalysisFilters = {
  type?: string;
  confidence?: string;
  dateFrom?: string;
  dateTo?: string;
};

function parseAnalysisRow(row: Record<string, unknown>): AiAnalysisHistoryRecord {
  const rawResult = JSON.parse(String(row.result_json)) as Partial<AiAnalysisResult>
  const normalizedResult: AiAnalysisResult = {
    generatedAt: rawResult.generatedAt ?? String(row.generated_at),
    cached: rawResult.cached ?? false,
    analysisStrength: rawResult.analysisStrength ?? 'medium',
    summary: rawResult.summary ?? '暂无分析总结',
    stance: rawResult.stance ?? '中性偏观察',
    facts: rawResult.facts ?? rawResult.evidence ?? [],
    inferences: rawResult.inferences ?? (rawResult.summary ? [rawResult.summary] : []),
    actionPlan: rawResult.actionPlan ?? rawResult.actionableObservations ?? [],
    invalidationSignals: rawResult.invalidationSignals ?? rawResult.risks ?? [],
    timeHorizons: rawResult.timeHorizons ?? [],
    probabilityAssessment: rawResult.probabilityAssessment ?? [],
    technicalSignals: rawResult.technicalSignals ?? [],
    newsDrivers: rawResult.newsDrivers ?? [],
    keyLevels: rawResult.keyLevels ?? [],
    positionAdvice: rawResult.positionAdvice,
    portfolioRiskNotes: rawResult.portfolioRiskNotes,
    actionableObservations: rawResult.actionableObservations ?? [],
    risks: rawResult.risks ?? [],
    confidence: rawResult.confidence ?? 'medium',
    disclaimer: rawResult.disclaimer ?? '以上内容仅供参考，不构成投资建议。',
    evidence: rawResult.evidence ?? [],
  }

  return {
    id: String(row.id),
    userId: String(row.user_id),
    type: String(row.analysis_type) as AiAnalysisHistoryRecord["type"],
    stockId: row.stock_id ? String(row.stock_id) : null,
    stockCode: row.stock_code ? String(row.stock_code) : null,
    stockName: row.stock_name ? String(row.stock_name) : null,
    market: row.market ? (String(row.market) as Market) : null,
    confidence: String(row.confidence) as AiAnalysisHistoryRecord["confidence"],
    tags: JSON.parse(String(row.tags_json)) as string[],
    result: normalizedResult,
    generatedAt: String(row.generated_at),
    createdAt: String(row.created_at),
  };
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

  function saveAiAnalysis(record: SaveAiAnalysisInput) {
    const createdAt = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO ai_analysis_history (
        id, user_id, analysis_type, stock_id, stock_code, stock_name, market,
        confidence, tags_json, result_json, generated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    ).run(
      record.id,
      record.userId,
      record.type,
      record.stockId ?? null,
      record.stockCode ?? null,
      record.stockName ?? null,
      record.market ?? null,
      record.confidence,
      JSON.stringify(record.tags),
      JSON.stringify(record.result),
      record.generatedAt,
      createdAt,
    );
  }

  function listAiAnalysisByUserId(userId: string, filters: ListAiAnalysisFilters = {}) {
    const clauses = ["user_id = ?"];
    const params: Array<string> = [userId];

    if (filters.type) {
      clauses.push("analysis_type = ?");
      params.push(filters.type);
    }
    if (filters.confidence) {
      clauses.push("confidence = ?");
      params.push(filters.confidence);
    }
    if (filters.dateFrom) {
      clauses.push("date(generated_at) >= date(?)");
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      clauses.push("date(generated_at) <= date(?)");
      params.push(filters.dateTo);
    }

    const rows = db.prepare(
      `
      SELECT *
      FROM ai_analysis_history
      WHERE ${clauses.join(" AND ")}
      ORDER BY generated_at DESC
      `,
    ).all(...params) as Array<Record<string, unknown>>;

    return rows.map(parseAnalysisRow);
  }

  function deleteAiAnalysisById(userId: string, id: string) {
    const result = db.prepare(
      `
      DELETE FROM ai_analysis_history
      WHERE user_id = ? AND id = ?
      `,
    ).run(userId, id);

    return result.changes > 0;
  }

  return {
    dbPath,
    getPortfolioByUserId,
    savePortfolioByUserId,
    saveAiAnalysis,
    listAiAnalysisByUserId,
    deleteAiAnalysisById,
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

export function saveAiAnalysis(record: SaveAiAnalysisInput) {
  portfolioStore.saveAiAnalysis(record);
}

export function listAiAnalysisByUserId(userId: string, filters: ListAiAnalysisFilters = {}) {
  return portfolioStore.listAiAnalysisByUserId(userId, filters);
}

export function deleteAiAnalysisById(userId: string, id: string) {
  return portfolioStore.deleteAiAnalysisById(userId, id);
}
