"use client";

import { create } from "zustand";
import { DEFAULT_APP_CONFIG } from "@/config/defaults";
import { getDeviceId } from "@/lib/device-id";
import { generateId } from "@/lib/finance";
import type { AppConfig, ExportData, Market, Stock, Trade } from "@/types";

interface StockStore {
  stocks: Stock[];
  config: AppConfig;
  userId: string | null;

  init: () => Promise<void>;
  sync: () => Promise<void>;
  addStock: (data: {
    code: string;
    name: string;
    market: Market;
    note?: string;
  }) => Promise<Stock>;
  updateStock: (id: string, data: Partial<Pick<Stock, "code" | "name" | "note">>) => Promise<void>;
  deleteStock: (id: string) => Promise<void>;
  addTrade: (
    stockId: string,
    trade: Omit<Trade, "id" | "stockId" | "createdAt" | "updatedAt">,
  ) => Promise<void>;
  updateTrade: (stockId: string, tradeId: string, data: Partial<Trade>) => Promise<void>;
  deleteTrade: (stockId: string, tradeId: string) => Promise<void>;
  updateConfig: (config: Partial<AppConfig>) => Promise<void>;
  exportData: () => ExportData;
  importData: (data: ExportData) => void;
  clearAll: () => void;
}

type StoredPayload = {
  stocks: Stock[];
  config: AppConfig;
};

const LOCAL_KEY = "stock-tracker-storage";
const LOCAL_SQLITE_USER_PREFIX = "local:";

function loadFromLocalStorage(): StoredPayload {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { stocks: [], config: DEFAULT_APP_CONFIG };
    const parsed = JSON.parse(raw) as Partial<StoredPayload>;
    return {
      stocks: parsed.stocks ?? [],
      config: { ...DEFAULT_APP_CONFIG, ...(parsed.config ?? {}) },
    };
  } catch (error) {
    console.error("Failed to load local data:", error);
    return { stocks: [], config: DEFAULT_APP_CONFIG };
  }
}

function saveToLocalStorage(stocks: Stock[], config: AppConfig) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ stocks, config }));
  } catch (error) {
    console.error("Failed to save local data:", error);
  }
}

function createLocalSqliteUserId() {
  return `${LOCAL_SQLITE_USER_PREFIX}${getDeviceId()}`;
}

function hasStoredData(payload: StoredPayload) {
  return (
    payload.stocks.length > 0 ||
    JSON.stringify(payload.config) !== JSON.stringify(DEFAULT_APP_CONFIG)
  );
}

async function fetchRemote(userId: string): Promise<StoredPayload> {
  const res = await fetch(`/api/storage?userId=${encodeURIComponent(userId)}`, {
    method: "GET",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load remote data (${res.status})`);
  const payload = (await res.json()) as StoredPayload;
  return {
    stocks: payload.stocks ?? [],
    config: { ...DEFAULT_APP_CONFIG, ...(payload.config ?? {}) },
  };
}

async function persistRemote(userId: string, stocks: Stock[], config: AppConfig) {
  const res = await fetch("/api/storage", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, stocks, config }),
  });
  if (!res.ok) throw new Error(`Failed to persist remote data (${res.status})`);
}

function sortTrades(stocks: Stock[]) {
  return stocks.map((stock) => ({
    ...stock,
    trades: [...stock.trades].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
  }));
}

export const useStockStore = create<StockStore>()((set, get) => ({
  stocks: [],
  config: DEFAULT_APP_CONFIG,
  userId: null,

  init: async () => {
    try {
      const local = loadFromLocalStorage();
      const userId = createLocalSqliteUserId();
      const sqlitePayload = await fetchRemote(userId);
      const nextPayload = hasStoredData(sqlitePayload) ? sqlitePayload : local;
      const normalized = sortTrades(nextPayload.stocks);

      if (!hasStoredData(sqlitePayload) && hasStoredData(local)) {
        await persistRemote(userId, normalized, nextPayload.config);
      }

      saveToLocalStorage(normalized, nextPayload.config);
      set({
        userId,
        stocks: normalized,
        config: nextPayload.config,
      });
    } catch (error) {
      console.error("Failed to initialize store:", error);
      const local = loadFromLocalStorage();
      const userId = createLocalSqliteUserId();
      set({
        userId,
        stocks: local.stocks,
        config: local.config,
      });
    }
  },

  sync: async () => {
    const userId = get().userId;
    if (!userId) return;
    try {
      const remote = await fetchRemote(userId);
      const normalized = sortTrades(remote.stocks);
      saveToLocalStorage(normalized, remote.config);
      set({
        stocks: normalized,
        config: remote.config,
      });
    } catch (error) {
      console.error("Sync failed:", error);
    }
  },

  addStock: async (data) => {
    const now = new Date().toISOString();
    const stock: Stock = {
      id: generateId(),
      ...data,
      trades: [],
      createdAt: now,
      updatedAt: now,
    };

    const nextStocks = [...get().stocks, stock];
    const nextConfig = get().config;
    set({ stocks: nextStocks });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Persist stock failed:", error);
      }
    }
    return stock;
  },

  updateStock: async (id, data) => {
    const now = new Date().toISOString();
    const nextStocks = get().stocks.map((s) => (s.id === id ? { ...s, ...data, updatedAt: now } : s));
    const nextConfig = get().config;
    set({ stocks: nextStocks });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Update stock failed:", error);
      }
    }
  },

  deleteStock: async (id) => {
    const nextStocks = get().stocks.filter((s) => s.id !== id);
    const nextConfig = get().config;
    set({ stocks: nextStocks });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Delete stock failed:", error);
      }
    }
  },

  addTrade: async (stockId, tradeData) => {
    const now = new Date().toISOString();
    const trade: Trade = {
      id: generateId(),
      stockId,
      ...tradeData,
      createdAt: now,
      updatedAt: now,
    };

    const nextStocks = sortTrades(
      get().stocks.map((s) => (s.id === stockId ? { ...s, updatedAt: now, trades: [...s.trades, trade] } : s)),
    );
    const nextConfig = get().config;
    set({ stocks: nextStocks });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Add trade failed:", error);
      }
    }
  },

  updateTrade: async (stockId, tradeId, data) => {
    const now = new Date().toISOString();
    const nextStocks = sortTrades(
      get().stocks.map((s) =>
        s.id === stockId
          ? {
              ...s,
              updatedAt: now,
              trades: s.trades.map((t) => (t.id === tradeId ? { ...t, ...data, updatedAt: now } : t)),
            }
          : s,
      ),
    );
    const nextConfig = get().config;
    set({ stocks: nextStocks });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Update trade failed:", error);
      }
    }
  },

  deleteTrade: async (stockId, tradeId) => {
    const nextStocks = get().stocks.map((s) =>
      s.id === stockId ? { ...s, trades: s.trades.filter((t) => t.id !== tradeId) } : s,
    );
    const nextConfig = get().config;
    set({ stocks: nextStocks });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Delete trade failed:", error);
      }
    }
  },

  updateConfig: async (configPatch) => {
    const nextConfig = { ...get().config, ...configPatch };
    const nextStocks = get().stocks;
    set({ config: nextConfig });
    saveToLocalStorage(nextStocks, nextConfig);

    const userId = get().userId;
    if (userId) {
      try {
        await persistRemote(userId, nextStocks, nextConfig);
      } catch (error) {
        console.error("Update config failed:", error);
      }
    }
  },

  exportData: () => {
    const { stocks, config } = get();
    return {
      meta: {
        version: config.version,
        exportedAt: new Date().toISOString(),
        appName: "StockTracker",
      },
      config,
      stocks,
    };
  },

  importData: (data) => {
    const next = {
      stocks: sortTrades(data.stocks),
      config: { ...DEFAULT_APP_CONFIG, ...data.config },
    };
    set(next);
    saveToLocalStorage(next.stocks, next.config);

    const userId = get().userId;
    if (userId) {
      void persistRemote(userId, next.stocks, next.config).catch((error) => {
        console.error("Import data failed:", error);
      });
    }
  },

  clearAll: () => {
    const next = { stocks: [], config: DEFAULT_APP_CONFIG };
    set(next);
    saveToLocalStorage(next.stocks, next.config);

    const userId = get().userId;
    if (userId) {
      void persistRemote(userId, next.stocks, next.config).catch((error) => {
        console.error("Clear data failed:", error);
      });
    }
  },
}));
