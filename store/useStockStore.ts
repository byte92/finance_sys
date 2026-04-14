"use client";

import { create } from "zustand";
import { useEffect, useRef } from "react";
import { DEFAULT_APP_CONFIG } from "@/config/defaults";
import { generateId } from "@/lib/finance";
import { supabase } from "@/lib/supabase/client";
import { canUseSupabaseAuth } from "@/lib/auth/mode";
import type { AppConfig, ExportData, Market, Stock, Trade } from "@/types";

export type SyncStatus = "idle" | "loading" | "synced" | "syncing" | "error" | "offline";

interface StockStore {
  stocks: Stock[];
  config: AppConfig;
  syncStatus: SyncStatus;
  isOffline: boolean;
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
  syncStatus: "idle",
  isOffline: false,
  userId: null,

  init: async () => {
    set({ syncStatus: "loading" });
    try {
      if (!canUseSupabaseAuth() || !supabase) {
        const local = loadFromLocalStorage();
        set({
          userId: null,
          stocks: local.stocks,
          config: local.config,
          isOffline: true,
          syncStatus: "offline",
        });
        return;
      }

      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (error) throw error;

      if (!session?.user?.id) {
        const local = loadFromLocalStorage();
        set({
          userId: null,
          stocks: local.stocks,
          config: local.config,
          isOffline: true,
          syncStatus: "offline",
        });
        return;
      }

      const userId = session.user.id;
      const remote = await fetchRemote(userId);
      const normalized = sortTrades(remote.stocks);
      saveToLocalStorage(normalized, remote.config);
      set({
        userId,
        stocks: normalized,
        config: remote.config,
        isOffline: false,
        syncStatus: "synced",
      });
    } catch (error) {
      console.error("Failed to initialize store:", error);
      const local = loadFromLocalStorage();
      set({
        stocks: local.stocks,
        config: local.config,
        isOffline: true,
        syncStatus: "error",
      });
    }
  },

  sync: async () => {
    const userId = get().userId;
    if (!userId) return;
    set({ syncStatus: "syncing" });
    try {
      const remote = await fetchRemote(userId);
      const normalized = sortTrades(remote.stocks);
      saveToLocalStorage(normalized, remote.config);
      set({
        stocks: normalized,
        config: remote.config,
        isOffline: false,
        syncStatus: "synced",
      });
    } catch (error) {
      console.error("Sync failed:", error);
      set({ syncStatus: "error", isOffline: true });
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
        set({ syncStatus: "synced", isOffline: false });
      } catch (error) {
        console.error("Persist stock failed:", error);
        set({ syncStatus: "error", isOffline: true });
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
        set({ syncStatus: "synced", isOffline: false });
      } catch (error) {
        console.error("Update stock failed:", error);
        set({ syncStatus: "error", isOffline: true });
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
        set({ syncStatus: "synced", isOffline: false });
      } catch (error) {
        console.error("Delete stock failed:", error);
        set({ syncStatus: "error", isOffline: true });
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
        set({ syncStatus: "synced", isOffline: false });
      } catch (error) {
        console.error("Add trade failed:", error);
        set({ syncStatus: "error", isOffline: true });
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
        set({ syncStatus: "synced", isOffline: false });
      } catch (error) {
        console.error("Update trade failed:", error);
        set({ syncStatus: "error", isOffline: true });
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
        set({ syncStatus: "synced", isOffline: false });
      } catch (error) {
        console.error("Delete trade failed:", error);
        set({ syncStatus: "error", isOffline: true });
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
        set({ syncStatus: "synced", isOffline: false });
      } catch (error) {
        console.error("Update config failed:", error);
        set({ syncStatus: "error", isOffline: true });
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
  },

  clearAll: () => {
    const next = { stocks: [], config: DEFAULT_APP_CONFIG };
    set(next);
    saveToLocalStorage(next.stocks, next.config);
  },
}));

export function useInitStore() {
  const { init, syncStatus } = useStockStore();
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      init();
      initialized.current = true;
    }
  }, [init]);

  return { syncStatus };
}

export function useSyncStatus() {
  const syncStatus = useStockStore((state) => state.syncStatus);
  const isOffline = useStockStore((state) => state.isOffline);
  return { syncStatus, isOffline };
}
