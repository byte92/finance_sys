import { DEFAULT_APP_CONFIG } from '@/config/defaults'
import { matchStocks } from '@/lib/agent/entity/stockMatcher'
import type { AgentSkill, AgentSkillCall } from '@/lib/agent/types'
import { calcStockSummary } from '@/lib/finance'
import { div, mul, roundMoney, roundTo } from '@/lib/money'
import type { Market, Stock, Trade } from '@/types'

type FinanceCalculationType = 'dividend.estimate'

type FinanceCalculateInput = {
  type?: string
  calculation?: string
  stockId?: string
  code?: string
  symbol?: string
  name?: string
  market?: Market
  quantity?: number | string
  cashPerShare?: number | string
  dividendPerShare?: number | string
  dividendPer10Shares?: number | string
  grossCashPerShare?: number | string
  netCashPerShare?: number | string
  currency?: string
}

type DividendEstimateResult = {
  calculationType: FinanceCalculationType
  stock: {
    id: string
    code: string
    name: string
    market: Market
  }
  quantity: number
  currency: string
  cashPerShare: number
  grossCashPerShare: number | null
  netCashPerShare: number | null
  estimatedAmount: number
  grossEstimatedAmount: number | null
  netEstimatedAmount: number | null
  formula: string
  source: {
    kind: 'input' | 'local_recent_dividend'
    tradeDate?: string
    tradeQuantity?: number
    tradeNetAmount?: number
    tradeTax?: number
  }
  assumptions: string[]
}

function findStock(stocks: Stock[], args: FinanceCalculateInput) {
  const stockId = typeof args.stockId === 'string' ? args.stockId : ''
  const code = typeof (args.code ?? args.symbol) === 'string' ? String(args.code ?? args.symbol).toUpperCase() : ''
  const name = typeof args.name === 'string' ? args.name : ''
  const market = typeof args.market === 'string' ? args.market : null

  return stocks.find((stock) => stock.id === stockId)
    ?? (code ? stocks.find((stock) => stock.code.toUpperCase() === code && (!market || stock.market === market)) : undefined)
    ?? (name ? matchStocks(name, stocks, 1)[0]?.stock : undefined)
    ?? null
}

function numberArg(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null

  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  if (!match) return null

  const num = Number(match[0])
  return Number.isFinite(num) ? num : null
}

function normalizeCalculationType(args: FinanceCalculateInput): FinanceCalculationType | null {
  const raw = String(args.type ?? args.calculation ?? '').trim().toLowerCase()
  if (!raw) return null
  if (raw === 'dividend.estimate' || raw.includes('dividend') || raw.includes('分红') || raw.includes('派息')) {
    return 'dividend.estimate'
  }
  return null
}

function latestDividendTrade(stock: Stock) {
  return [...stock.trades]
    .filter((trade) => trade.type === 'DIVIDEND')
    .sort((a, b) => {
      const dateOrder = b.date.localeCompare(a.date)
      if (dateOrder !== 0) return dateOrder
      return b.createdAt.localeCompare(a.createdAt)
    })[0] ?? null
}

function perShareFromTrade(trade: Trade | null) {
  if (!trade) return { gross: null, net: null }

  const gross = trade.price > 0 ? trade.price : null
  const net = trade.quantity > 0 && trade.netAmount > 0 ? div(trade.netAmount, trade.quantity) : null
  return {
    gross: gross === null ? null : roundTo(gross, 6),
    net: net === null ? null : roundTo(net, 6),
  }
}

function explicitPerShare(args: FinanceCalculateInput) {
  const net = numberArg(args.netCashPerShare)
  if (net !== null) return { cashPerShare: net, gross: numberArg(args.grossCashPerShare), net, source: 'netCashPerShare' }

  const gross = numberArg(args.grossCashPerShare)
  if (gross !== null) return { cashPerShare: gross, gross, net: null, source: 'grossCashPerShare' }

  const perShare = numberArg(args.cashPerShare) ?? numberArg(args.dividendPerShare)
  if (perShare !== null) return { cashPerShare: perShare, gross: perShare, net: null, source: 'cashPerShare' }

  const per10 = numberArg(args.dividendPer10Shares)
  if (per10 !== null) {
    const amount = div(per10, 10)
    return { cashPerShare: amount, gross: amount, net: null, source: 'dividendPer10Shares' }
  }

  return null
}

function buildDividendSearch(stock: Stock): AgentSkillCall {
  return {
    name: 'web.search',
    args: {
      query: `${stock.name} ${stock.code} 最新 分红 每股派息 股权登记日 除权除息`,
      limit: 5,
      searchLimit: 10,
    },
    reason: '缺少可用于估算的每股分红金额，需要搜索公开分红/派息信息',
  }
}

function estimateDividend(args: FinanceCalculateInput, stock: Stock) {
  const explicit = explicitPerShare(args)
  const recentDividend = latestDividendTrade(stock)
  const recentPerShare = perShareFromTrade(recentDividend)
  const summary = calcStockSummary(stock)
  const quantity = numberArg(args.quantity) ?? summary.currentHolding

  if (quantity <= 0) {
    return {
      skillName: 'finance.calculate',
      ok: false,
      error: '当前没有可用于估算的持仓数量。',
    }
  }

  const cashPerShare = explicit?.cashPerShare ?? recentPerShare.net ?? recentPerShare.gross
  if (cashPerShare === null || cashPerShare === undefined) {
    return {
      skillName: 'finance.calculate',
      ok: false,
      error: '缺少分红每股金额，无法估算本次可分金额。',
      needsFollowUp: true,
      suggestedSkills: [buildDividendSearch(stock)],
    }
  }

  const grossCashPerShare = explicit?.gross ?? recentPerShare.gross
  const netCashPerShare = explicit?.net ?? recentPerShare.net
  const estimatedAmount = roundMoney(mul(quantity, cashPerShare))
  const grossEstimatedAmount = grossCashPerShare === null || grossCashPerShare === undefined
    ? null
    : roundMoney(mul(quantity, grossCashPerShare))
  const netEstimatedAmount = netCashPerShare === null || netCashPerShare === undefined
    ? null
    : roundMoney(mul(quantity, netCashPerShare))
  const currency = args.currency || DEFAULT_APP_CONFIG.currency[stock.market]
  const sourceKind = explicit ? 'input' : 'local_recent_dividend'

  const assumptions = [
    explicit
      ? '按用户问题或 Planner 提取出的每股/每 10 股现金分配金额估算。'
      : recentDividend
        ? `按本地最近一次现金收益记录（${recentDividend.date}）的实际口径估算。`
        : '',
    numberArg(args.quantity) === null
      ? `使用当前本地持仓数量 ${quantity} 估算。`
      : `使用问题中给出的数量 ${quantity} 估算。`,
    grossEstimatedAmount !== null && netEstimatedAmount !== null && grossEstimatedAmount !== netEstimatedAmount
      ? '本地历史记录同时包含税前与实际到账口径，默认回答实际到账估算，并附税前金额。'
      : '',
  ].filter(Boolean)

  const data: DividendEstimateResult = {
    calculationType: 'dividend.estimate',
    stock: {
      id: stock.id,
      code: stock.code,
      name: stock.name,
      market: stock.market,
    },
    quantity,
    currency,
    cashPerShare: roundTo(cashPerShare, 6),
    grossCashPerShare: grossCashPerShare === null || grossCashPerShare === undefined ? null : roundTo(grossCashPerShare, 6),
    netCashPerShare: netCashPerShare === null || netCashPerShare === undefined ? null : roundTo(netCashPerShare, 6),
    estimatedAmount,
    grossEstimatedAmount,
    netEstimatedAmount,
    formula: `${quantity} × ${roundTo(cashPerShare, 6)} = ${estimatedAmount}`,
    source: sourceKind === 'local_recent_dividend'
      ? {
          kind: sourceKind,
          tradeDate: recentDividend?.date,
          tradeQuantity: recentDividend?.quantity,
          tradeNetAmount: recentDividend?.netAmount,
          tradeTax: recentDividend?.tax,
        }
      : { kind: sourceKind },
    assumptions,
  }

  return { skillName: 'finance.calculate', ok: true, data }
}

export const financeCalculateSkill: AgentSkill<FinanceCalculateInput, DividendEstimateResult> = {
  name: 'finance.calculate',
  description: '执行受控的投资业务域计算，例如基于当前持仓和分红口径估算可分金额。',
  inputSchema: {
    type: 'dividend.estimate',
    stockId: 'string',
    code: 'string',
    symbol: 'string',
    market: 'Market',
    quantity: 'number?',
    cashPerShare: 'number?',
    dividendPer10Shares: 'number?',
  },
  requiredScopes: ['stock.read', 'trade.read'],
  async execute(args, ctx) {
    const calculationType = normalizeCalculationType(args)
    if (!calculationType) {
      return {
        skillName: 'finance.calculate',
        ok: false,
        error: '暂不支持该业务计算类型。',
      }
    }

    const stock = findStock(ctx.stocks, args)
    if (!stock) {
      return {
        skillName: 'finance.calculate',
        ok: false,
        error: '未找到可用于计算的本地持仓标的。',
      }
    }

    if (calculationType === 'dividend.estimate') {
      return estimateDividend(args, stock)
    }

    return {
      skillName: 'finance.calculate',
      ok: false,
      error: '暂不支持该业务计算类型。',
    }
  },
}
