"use client";

import { create } from "zustand";
import { useEffect, useRef } from "react";
import { DEFAULT_APP_CONFIG } from "@/config/defaults";
import { generateId } from "@/lib/finance";
import { supabase } from "@/lib/supabase/client";
import type { AppConfig, ExportData, Market, Stock, Trade } from "@/types";
import type { Database } from "@/lib/supabase/client";

// Sync status for the store
export type SyncStatus = "idle" | "loading" | "synced" | "syncing" | "error" | "offline";

// Shape of the portfolio state.
interface StockStore {
  stocks: Stock[];
  config: AppConfig;
  syncStatus: SyncStatus;
  isOffline: boolean;
  userId: string | null;

  // Actions
  init: () => Promise<void>;
  sync: () => Promise<void>;

  // 股票操作
  addStock: (data: {
    code: string;
    name: string;
    market: Market;
    note?: string;
  }) => Promise<Stock>;
  updateStock: (
    id: string,
    data: Partial<Pick<Stock, "code" | "name" | "note">>,
  ) => Promise<void>;
  deleteStock: (id: string) => Promise<void>;

  // 交易操作
  addTrade: (
    stockId: string,
    trade: Omit<Trade, "id" | "stockId" | "createdAt" | "updatedAt">,
  ) => Promise<void>;
  updateTrade: (stockId: string, tradeId: string, data: Partial<Trade>) => Promise<void>;
  deleteTrade: (stockId: string, tradeId: string) => Promise<void>;

  // 配置
  updateConfig: (config: Partial<AppConfig>) => Promise<void>;

  // 导入导出
  exportData: () => ExportData;
  importData: (data: ExportData) => void;
  clearAll: () => void;
}

// Helper to convert Supabase stock to Stock type
function fromSupabaseStock(
  data: Database['public']['Tables']['stocks']['Row'],
  trades: Database['public']['Tables']['trades']['Row'][] = [],
): Stock {
  return {
    id: data.id,
    code: data.code,
    name: data.name,
    market: data.market,
    note: data.note || undefined,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    trades: trades.map((t) => fromSupabaseTrade(t)),
  };
}

// Helper to convert Supabase trade to Trade type
function fromSupabaseTrade(
  data: Database['public']['Tables']['trades']['Row'],
): Trade {
  return {
    id: data.id,
    stockId: data.stock_id,
    type: data.type,
    date: data.date,
    price: data.price,
    quantity: data.quantity,
    commission: data.commission,
    tax: data.tax,
    totalAmount: data.total_amount,
    netAmount: data.net_amount,
    note: data.note || undefined,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

// Check if Supabase is configured and available
function isSupabaseAvailable(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// Load from localStorage as fallback
function loadFromLocalStorage(): { stocks: Stock[]; config: AppConfig } {
  try {
    const stored = localStorage.getItem("stock-tracker-storage");
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        stocks: parsed.stocks || [],
        config: parsed.config || DEFAULT_APP_CONFIG,
      };
    }
  } catch (error) {
    console.error("Failed to load from localStorage:", error);
  }
  return { stocks: [], config: DEFAULT_APP_CONFIG };
}

function saveToLocalStorage(stocks: Stock[], config: AppConfig) {
  try {
    localStorage.setItem(
      "stock-tracker-storage",
      JSON.stringify({ stocks, config }),
    );
  } catch (error) {
    console.error("Failed to save to localStorage:", error);
  }
}

const DEVICE_ID_KEY = "finance-sys-device-id";

function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = generateId();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch (error) {
    console.error("Failed to read/write device id:", error);
    return generateId();
  }
}

export const useStockStore = create<StockStore>()((set, get) => ({
  stocks: [],
  config: DEFAULT_APP_CONFIG,
  syncStatus: "idle",
  isOffline: false,
  userId: null,

  // Initialize the store
  init: async () => {
    const available = isSupabaseAvailable();

    if (!available) {
      console.warn("Supabase not configured, using localStorage");
      set({ isOffline: true, syncStatus: "offline" });
      const localData = loadFromLocalStorage();
      set({ stocks: localData.stocks, config: localData.config });
      return;
    }

    set({ syncStatus: "loading" });

    try {
      // Get auth session
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session) {
        console.log("No auth session, waiting for login");
        set({
          isOffline: false,
          syncStatus: "idle",
          userId: null,
          stocks: [],
          config: DEFAULT_APP_CONFIG,
        });
        return;
      }

      const userId = session.user.id;
      set({ userId, isOffline: false });

      // Ensure user row exists for FK + RLS
      const deviceId = getOrCreateDeviceId();
      const now = new Date().toISOString();
      const { error: userUpsertError } = await supabase
        .from("users")
        .upsert(
          {
            id: userId,
            device_id: deviceId,
            created_at: now,
            last_sync_at: null,
          },
          { onConflict: "id" },
        );

      if (userUpsertError) {
        throw userUpsertError;
      }

      // Load config
      const { data: configData } = await supabase
        .from("app_config")
        .select("config")
        .eq("user_id", userId)
        .maybeSingle();

      if (configData?.config) {
        set({ config: { ...DEFAULT_APP_CONFIG, ...configData.config } });
      }

      // Load stocks with trades
      const { data: stocksData } = await supabase
        .from("stocks")
        .select("*, trades(*)")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      const stocks = (stocksData || []).map((stock: { trades?: Database['public']['Tables']['trades']['Row'][] }) => {
        const trades = (stock.trades || []).sort(
          (a, b) =>
            new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
        return fromSupabaseStock(stock as Database['public']['Tables']['stocks']['Row'], trades);
      });

      set({ stocks, syncStatus: "synced" });
    } catch (error) {
      console.error("Failed to initialize from Supabase:", error);
      set({ syncStatus: "error", isOffline: true });

      // Fallback to localStorage
      const localData = loadFromLocalStorage();
      set({ stocks: localData.stocks, config: localData.config });
    }
  },

  // Manual sync
  sync: async () => {
    if (get().isOffline) return;
    set({ syncStatus: "syncing" });

    try {
      const userId = get().userId;
      if (!userId) {
        await get().init();
        return;
      }

      // Reload stocks
      const { data: stocksData } = await supabase
        .from("stocks")
        .select("*, trades(*)")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      const stocks = (stocksData || []).map((stock: { trades?: Database['public']['Tables']['trades']['Row'][] }) => {
        const trades = (stock.trades || []).sort(
          (a, b) =>
            new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
        return fromSupabaseStock(stock as Database['public']['Tables']['stocks']['Row'], trades);
      });

      set({ stocks, syncStatus: "synced" });
    } catch (error) {
      console.error("Sync failed:", error);
      set({ syncStatus: "error" });
    }
  },

  addStock: async (data) => {
    if (get().isOffline) {
      // Fallback to localStorage
      const now = new Date().toISOString();
      const stock: Stock = {
        id: generateId(),
        ...data,
        trades: [],
        createdAt: now,
        updatedAt: now,
      };
      set((state) => {
        const next = { ...state, stocks: [...state.stocks, stock] };
        saveToLocalStorage(next.stocks, next.config);
        return next;
      });
      return stock;
    }

    const userId = get().userId;
    if (!userId) throw new Error("Not initialized");

    const now = new Date().toISOString();
    const { data: result, error } = await supabase
      .from("stocks")
      .insert({
        user_id: userId,
        code: data.code,
        name: data.name,
        market: data.market,
        note: data.note || null,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error || !result) {
      throw error || new Error("Failed to add stock");
    }

    const stock = fromSupabaseStock(result);
    set((state) => ({ stocks: [...state.stocks, stock] }));
    return stock;
  },

  updateStock: async (id, data) => {
    if (get().isOffline) {
      set((state) => {
        const nextStocks = state.stocks.map((s) =>
          s.id === id
            ? { ...s, ...data, updatedAt: new Date().toISOString() }
            : s,
        );
        const next = { ...state, stocks: nextStocks };
        saveToLocalStorage(next.stocks, next.config);
        return next;
      });
      return;
    }

    const { error } = await supabase
      .from("stocks")
      .update({
        ...data,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;
  },

  deleteStock: async (id) => {
    if (get().isOffline) {
      set((state) => {
        const next = {
          ...state,
          stocks: state.stocks.filter((s) => s.id !== id),
        };
        saveToLocalStorage(next.stocks, next.config);
        return next;
      });
      return;
    }

    const { error } = await supabase.from("stocks").delete().eq("id", id);
    if (error) throw error;
  },

  addTrade: async (stockId, tradeData) => {
    if (get().isOffline) {
      const now = new Date().toISOString();
      const trade: Trade = {
        id: generateId(),
        stockId,
        ...tradeData,
        createdAt: now,
        updatedAt: now,
      };
      set((state) => {
        const nextStocks = state.stocks.map((s) =>
          s.id === stockId
            ? { ...s, trades: [...s.trades, trade], updatedAt: now }
            : s,
        );
        const next = { ...state, stocks: nextStocks };
        saveToLocalStorage(next.stocks, next.config);
        return next;
      });
      return;
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("trades")
      .insert({
        stock_id: stockId,
        type: tradeData.type,
        date: tradeData.date,
        price: tradeData.price,
        quantity: tradeData.quantity,
        commission: tradeData.commission,
        tax: tradeData.tax,
        total_amount: tradeData.totalAmount,
        net_amount: tradeData.netAmount,
        note: tradeData.note || null,
        created_at: now,
        updated_at: now,
      });

    if (error) throw error;
  },

  updateTrade: async (stockId, tradeId, data) => {
    if (get().isOffline) {
      const now = new Date().toISOString();
      set((state) => {
        const nextStocks = state.stocks.map((s) =>
          s.id === stockId
            ? {
                ...s,
                updatedAt: now,
                trades: s.trades.map((t) =>
                  t.id === tradeId ? { ...t, ...data, updatedAt: now } : t,
                ),
              }
            : s,
        );
        const next = { ...state, stocks: nextStocks };
        saveToLocalStorage(next.stocks, next.config);
        return next;
      });
      return;
    }

    const { error } = await supabase
      .from("trades")
      .update({
        ...data,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tradeId);

    if (error) throw error;
  },

  deleteTrade: async (stockId, tradeId) => {
    if (get().isOffline) {
      set((state) => {
        const nextStocks = state.stocks.map((s) =>
          s.id === stockId
            ? { ...s, trades: s.trades.filter((t) => t.id !== tradeId) }
            : s,
        );
        const next = { ...state, stocks: nextStocks };
        saveToLocalStorage(next.stocks, next.config);
        return next;
      });
      return;
    }

    const { error } = await supabase.from("trades").delete().eq("id", tradeId);
    if (error) throw error;
  },

  updateConfig: async (config) => {
    const userId = get().userId;

    if (!userId || get().isOffline) {
      set((state) => {
        const next = { ...state, config: { ...state.config, ...config } };
        saveToLocalStorage(next.stocks, next.config);
        return next;
      });
      return;
    }

    const updatedConfig = { ...get().config, ...config };

    const { error } = await supabase
      .from("app_config")
      .update({
        config: updatedConfig as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (error) throw error;

    set({ config: updatedConfig });
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

  importData: (data: ExportData) => {
    set((state) => {
      const next = {
        ...state,
        stocks: data.stocks,
        config: { ...DEFAULT_APP_CONFIG, ...data.config },
      };
      saveToLocalStorage(next.stocks, next.config);
      return next;
    });
  },

  clearAll: () => {
    set((state) => {
      const next = { ...state, stocks: [], config: DEFAULT_APP_CONFIG };
      saveToLocalStorage(next.stocks, next.config);
      return next;
    });
  },
}));

// Global subscriptions manager
let subscriptions: RealtimeChannel[] = [];

// Subscribe to real-time changes
function subscribeToChanges(userId: string, set: (state: Partial<StockStore>) => void) {
  // Subscribe to stocks changes
  const stocksChannel = supabase
    .channel(`stocks:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "stocks",
        filter: `user_id=eq.${userId}`,
      },
      async (payload) => {
        const store = useStockStore.getState();
        let stocks = [...store.stocks];

        switch (payload.eventType) {
          case "INSERT": {
            const newStock = fromSupabaseStock(payload.new);
            stocks.push(newStock);
            break;
          }
          case "UPDATE": {
            stocks = stocks.map((s) =>
              s.id === payload.new.id ? fromSupabaseStock(payload.new) : s,
            );
            break;
          }
          case "DELETE": {
            stocks = stocks.filter((s) => s.id !== payload.old.id);
            break;
          }
        }

        set({ stocks });
      },
    )
    .subscribe();

  subscriptions.push(stocksChannel);

  // Subscribe to trades changes
  const tradesChannel = supabase
    .channel(`trades:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "trades",
      },
      async (payload) => {
        const store = useStockStore.getState();
        const stockId =
          payload.eventType === "DELETE"
            ? payload.old.stock_id
            : payload.new.stock_id;
        const stock = store.stocks.find((s) => s.id === stockId);

        if (!stock) return;

        let trades = [...stock.trades];

        switch (payload.eventType) {
          case "INSERT": {
            trades.push(fromSupabaseTrade(payload.new));
            break;
          }
          case "UPDATE": {
            trades = trades.map((t) =>
              t.id === payload.new.id ? fromSupabaseTrade(payload.new) : t,
            );
            break;
          }
          case "DELETE": {
            trades = trades.filter((t) => t.id !== payload.old.id);
            break;
          }
        }

        // Sort trades by date
        trades.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );

        set({
          stocks: store.stocks.map((s) =>
            s.id === stockId
              ? { ...s, trades, updatedAt: new Date().toISOString() }
              : s,
          ),
        });
      },
    )
    .subscribe();

  subscriptions.push(tradesChannel);
}

// Cleanup subscriptions
function cleanupSubscriptions() {
  subscriptions.forEach((channel) => supabase.removeChannel(channel));
  subscriptions = [];
}

// Initialize hook
export function useInitStore() {
  const { init, sync, syncStatus, userId } = useStockStore();
  const initialized = useRef(false);
  const subscribedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!initialized.current) {
      init();
      initialized.current = true;
    }

    return () => {
      // Cleanup subscriptions when component unmounts
      cleanupSubscriptions();
    };
  }, [init]);

  useEffect(() => {
    if (syncStatus === "error") {
      // Retry after 5 seconds
      const timeout = setTimeout(() => {
        if (useStockStore.getState().isOffline) {
          sync();
        }
      }, 5000);

      return () => clearTimeout(timeout);
    }
  }, [syncStatus]);

  // Reinitialize when userId changes (login/logout)
  useEffect(() => {
    if (initialized.current) {
      init();
    }
  }, [userId, init]);

  // Subscribe to real-time changes when userId is available
  useEffect(() => {
    if (userId && userId !== subscribedUserId.current) {
      // Cleanup old subscriptions
      if (subscribedUserId.current) {
        cleanupSubscriptions();
      }

      // Subscribe to changes
      subscribeToChanges(userId, (state) => useStockStore.setState(state));
      subscribedUserId.current = userId;
    }

    return () => {
      // Cleanup on unmount
      cleanupSubscriptions();
    };
  }, [userId]);

  return { syncStatus };
}

// Hook for sync status
export function useSyncStatus() {
  const syncStatus = useStockStore((state) => state.syncStatus);
  const isOffline = useStockStore((state) => state.isOffline);

  return { syncStatus, isOffline };
}
