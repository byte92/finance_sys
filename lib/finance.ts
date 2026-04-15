import { DEFAULT_FEE_CONFIGS } from "@/config/defaults";
import type {
  FeeConfig,
  Market,
  Stock,
  StockSummary,
  Trade,
  TradePnlDetail,
} from "@/types";

type FeeBreakdown = {
  commission: number;
  tax: number;
  transferFee: number;
  netAmount: number;
};

type MainlandFeeProfile = "A_STOCK" | "A_ETF_OR_FUND";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function calcCommission(totalAmount: number, config: FeeConfig): number {
  return roundMoney(
    Math.max(totalAmount * config.commissionRate, config.minCommission),
  );
}

function getMainlandFeeProfile(
  market: Market,
  stockCode?: string,
): MainlandFeeProfile | null {
  if (market === "FUND") return "A_ETF_OR_FUND";
  if (market !== "A") return null;
  if (!stockCode) return "A_STOCK";

  const normalized = stockCode.trim().toUpperCase();
  const etfPrefixes = ["5", "15", "16", "18"];
  return etfPrefixes.some((prefix) => normalized.startsWith(prefix))
    ? "A_ETF_OR_FUND"
    : "A_STOCK";
}

function calcBuyCharges(
  totalAmount: number,
  config: FeeConfig,
  market: Market,
  stockCode?: string,
): FeeBreakdown {
  const commission = calcCommission(totalAmount, config);
  const mainlandProfile = getMainlandFeeProfile(market, stockCode);

  let stampDuty = 0;
  let transferFee = 0;
  let settlementFee = 0;

  if (market === "HK") {
    stampDuty = roundMoney(totalAmount * config.stampDutyRate);
    settlementFee = roundMoney(totalAmount * (config.settlementFeeRate ?? 0));
  } else if (mainlandProfile === "A_STOCK") {
    transferFee = roundMoney(totalAmount * config.transferFeeRate);
  }

  const tax = roundMoney(stampDuty + transferFee + settlementFee);
  const netAmount = roundMoney(totalAmount + commission + tax);
  return { commission, tax, transferFee, netAmount };
}

function calcSellCharges(
  totalAmount: number,
  config: FeeConfig,
  market: Market,
  stockCode?: string,
): FeeBreakdown {
  const commission = calcCommission(totalAmount, config);
  const mainlandProfile = getMainlandFeeProfile(market, stockCode);

  let stampDuty = 0;
  let transferFee = 0;
  let settlementFee = 0;

  if (market === "HK") {
    stampDuty = roundMoney(totalAmount * config.stampDutyRate);
    settlementFee = roundMoney(totalAmount * (config.settlementFeeRate ?? 0));
  } else if (mainlandProfile === "A_STOCK") {
    stampDuty = roundMoney(totalAmount * config.stampDutyRate);
    transferFee = roundMoney(totalAmount * config.transferFeeRate);
  }

  const tax = roundMoney(stampDuty + transferFee + settlementFee);
  const netAmount = roundMoney(totalAmount - commission - tax);
  return { commission, tax, transferFee, netAmount };
}

// 计算单笔买入的实际成本（含手续费）
export function calcBuyNetAmount(
  price: number,
  quantity: number,
  config: FeeConfig,
  market?: Market,
  stockCode?: string,
): FeeBreakdown {
  const totalAmount = price * quantity;
  return calcBuyCharges(totalAmount, config, market ?? config.market, stockCode);
}

// 计算单笔卖出的实际到账（扣手续费）
export function calcSellNetAmount(
  price: number,
  quantity: number,
  config: FeeConfig,
  stockCode?: string,
): FeeBreakdown {
  const totalAmount = price * quantity;
  return calcSellCharges(totalAmount, config, config.market, stockCode);
}

// 自动计算手续费并生成Trade对象的费用字段
export function autoCalcFees(
  type: "BUY" | "SELL",
  price: number,
  quantity: number,
  market: Market,
  stockCode?: string,
  config?: FeeConfig,
): { commission: number; tax: number; netAmount: number } {
  const feeConfig = config ?? DEFAULT_FEE_CONFIGS[market];
  if (type === "BUY") {
    const { commission, tax, netAmount } = calcBuyNetAmount(
      price,
      quantity,
      feeConfig,
      market,
      stockCode,
    );
    return { commission, tax, netAmount };
  } else {
    const { commission, tax, netAmount } = calcSellNetAmount(
      price,
      quantity,
      feeConfig,
      stockCode,
    );
    return { commission, tax, netAmount };
  }
}

// 计算股票整体盈亏摘要（FIFO方法）
// 支持：BUY / SELL / DIVIDEND
export function calcStockSummary(
  stock: Stock,
  currentPrice?: number,
): StockSummary {
  const trades = [...stock.trades].sort((a, b) => a.date.localeCompare(b.date));

  let totalBuyAmount = 0;
  let totalSellAmount = 0;
  let totalCommission = 0;
  let currentHolding = 0;
  let realizedPnl = 0;
  let totalDividend = 0;
  let tradeCount = 0;

  // FIFO 成本队列：{ price: 每股摊薄成本, quantity: 数量 }
  const costQueue: Array<{ price: number; quantity: number }> = [];

  // 每笔交易盈亏明细
  const tradePnlDetails: TradePnlDetail[] = [];

  for (const trade of trades) {
    if (trade.type === "BUY") {
      tradeCount++;
      totalCommission += trade.commission + trade.tax;
      totalBuyAmount += trade.netAmount;
      currentHolding += trade.quantity;
      // 每股均摊成本（含手续费）
      costQueue.push({
        price: trade.netAmount / trade.quantity,
        quantity: trade.quantity,
      });

      tradePnlDetails.push({
        tradeId: trade.id,
        type: "BUY",
        date: trade.date,
        pnl: 0, // 买入本身无盈亏
        pnlPercent: 0,
        costBasis: trade.netAmount,
        proceeds: 0,
      });
    } else if (trade.type === "SELL") {
      tradeCount++;
      totalCommission += trade.commission + trade.tax;
      totalSellAmount += trade.netAmount;

      // FIFO 出队，计算本次卖出的成本基础
      let remaining = trade.quantity;
      let costBasis = 0;
      while (remaining > 0 && costQueue.length > 0) {
        const head = costQueue[0];
        if (head.quantity <= remaining) {
          costBasis += head.price * head.quantity;
          remaining -= head.quantity;
          costQueue.shift();
        } else {
          costBasis += head.price * remaining;
          head.quantity -= remaining;
          remaining = 0;
        }
      }

      const pnl = trade.netAmount - costBasis;
      const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
      realizedPnl += pnl;
      currentHolding -= trade.quantity;

      tradePnlDetails.push({
        tradeId: trade.id,
        type: "SELL",
        date: trade.date,
        pnl,
        pnlPercent,
        costBasis,
        proceeds: trade.netAmount,
      });
    } else if (trade.type === "DIVIDEND") {
      // 分红：计入已实现盈亏，但不再二次摊薄持仓成本。
      // 否则会同时把分红算作收益、又降低未来卖出成本，导致收益被双重放大。
      const dividendAmount = trade.netAmount; // 税后到手
      totalDividend += dividendAmount;
      realizedPnl += dividendAmount;

      tradePnlDetails.push({
        tradeId: trade.id,
        type: "DIVIDEND",
        date: trade.date,
        pnl: dividendAmount,
        pnlPercent: 0,
        costBasis: 0,
        proceeds: dividendAmount,
        isDividend: true,
      });
    }
  }

  // 剩余持仓成本
  const remainingCost = costQueue.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const avgCostPrice = currentHolding > 0 ? remainingCost / currentHolding : 0;
  const unrealizedPnl =
    currentHolding > 0 && currentPrice
      ? currentPrice * currentHolding - remainingCost
      : 0;

  const totalPnl = realizedPnl + unrealizedPnl;
  const totalInvested = totalBuyAmount;
  const totalPnlPercent =
    totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  return {
    stock,
    totalBuyAmount,
    totalSellAmount,
    currentHolding,
    avgCostPrice,
    realizedPnl,
    unrealizedPnl,
    totalPnl,
    totalPnlPercent,
    totalCommission,
    totalDividend,
    tradeCount,
    tradePnlDetails,
  };
}

// 格式化金额
export function formatAmount(value: number, decimals = 2): string {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// 格式化盈亏（带+/-号）
export function formatPnl(
  value: number,
  currency = "CNY",
  decimals = 2,
): string {
  const sign = value >= 0 ? "+" : "";
  const symbols: Record<string, string> = {
    CNY: "¥",
    HKD: "HK$",
    USD: "$",
    USDT: "$",
  };
  const symbol = symbols[currency] || "¥";
  return `${sign}${symbol}${formatAmount(value, decimals)}`;
}

// 格式化百分比
export function formatPercent(value: number, decimals = 2): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

// 生成UUID
export function generateId(): string {
  return crypto.randomUUID();
}

// 获取今天的日期字符串
export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
