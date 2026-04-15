import { DEFAULT_FEE_CONFIGS } from "@/config/defaults";
import type {
  FeeConfig,
  Market,
  Stock,
  StockSummary,
  Trade,
  TradePnlDetail,
} from "@/types";

// 计算单笔买入的实际成本（含手续费）
export function calcBuyNetAmount(
  price: number,
  quantity: number,
  config: FeeConfig,
  market?: Market,
): { commission: number; tax: number; netAmount: number } {
  const totalAmount = price * quantity;
  const commission = Math.max(
    totalAmount * config.commissionRate,
    config.minCommission,
  );
  const stampDuty = market === "HK" ? totalAmount * config.stampDutyRate : 0;
  const settlementFee =
    market === "HK" ? totalAmount * (config.settlementFeeRate ?? 0) : 0;
  const tax = stampDuty + settlementFee;
  const netAmount = totalAmount + commission + tax;
  return { commission, tax, netAmount };
}

// 计算单笔卖出的实际到账（扣手续费）
export function calcSellNetAmount(
  price: number,
  quantity: number,
  config: FeeConfig,
  stockCode?: string,
): { commission: number; tax: number; transferFee: number; netAmount: number } {
  const totalAmount = price * quantity;
  const commission = Math.max(
    totalAmount * config.commissionRate,
    config.minCommission,
  );
  const stampDuty = totalAmount * config.stampDutyRate;
  const settlementFee =
    config.market === "HK" ? totalAmount * (config.settlementFeeRate ?? 0) : 0;
  // 沪市过户费（上交所：6xxxxx / 5xxxxx ETF）
  const isSH = stockCode
    ? stockCode.startsWith("6") || stockCode.startsWith("5")
    : false;
  const transferFee = isSH ? totalAmount * config.transferFeeRate : 0;
  const tax = stampDuty + settlementFee + transferFee;
  const netAmount = totalAmount - commission - tax;
  return { commission, tax, transferFee, netAmount };
}

// 自动计算手续费并生成Trade对象的费用字段
export function autoCalcFees(
  type: "BUY" | "SELL",
  price: number,
  quantity: number,
  market: Market,
  stockCode?: string,
): { commission: number; tax: number; netAmount: number } {
  const config = DEFAULT_FEE_CONFIGS[market];
  if (type === "BUY") {
    return calcBuyNetAmount(price, quantity, config, market);
  } else {
    const { commission, tax, netAmount } = calcSellNetAmount(
      price,
      quantity,
      config,
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
