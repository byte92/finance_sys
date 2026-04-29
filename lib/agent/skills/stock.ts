import { buildTechnicalIndicatorSnapshot } from '@/lib/technicalIndicators'
import { calcStockSummary } from '@/lib/finance'
import { stockPriceService } from '@/lib/StockPriceService'
import { matchStocks } from '@/lib/agent/entity/stockMatcher'
import { fetchDailyCandles } from '@/lib/external/kline'
import type { AgentSkill } from '@/lib/agent/types'
import type { Market, Stock } from '@/types'
import type { StockQuote } from '@/types/stockApi'

function findStock(stocks: Stock[], args: Record<string, unknown>) {
  const stockId = typeof args.stockId === 'string' ? args.stockId : ''
  const code = typeof args.code === 'string' ? args.code.toUpperCase() : ''
  const name = typeof args.name === 'string' ? args.name : ''
  return stocks.find((stock) => stock.id === stockId)
    ?? (code ? stocks.find((stock) => stock.code.toUpperCase() === code) : undefined)
    ?? (name ? matchStocks(name, stocks, 1)[0]?.stock : undefined)
    ?? null
}

function quoteToContext(quote: StockQuote | null) {
  if (!quote) return null
  return {
    symbol: quote.symbol,
    name: quote.name,
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
    peTtm: quote.peTtm ?? null,
    epsTtm: quote.epsTtm ?? null,
    pb: quote.pb ?? null,
    marketCap: quote.marketCap ?? null,
    currency: quote.currency,
    source: quote.source,
    valuationSource: quote.valuationSource ?? null,
    timestamp: quote.timestamp,
  }
}

export const stockMatchSkill: AgentSkill<{ query?: string }> = {
  name: 'stock.match',
  description: '根据用户输入匹配本地持仓中的股票。',
  inputSchema: { query: 'string' },
  requiredScopes: ['stock.read'],
  async execute(args, ctx) {
    const matches = matchStocks(args.query ?? '', ctx.stocks, 5).map((match) => ({
      id: match.stock.id,
      code: match.stock.code,
      name: match.stock.name,
      market: match.stock.market,
      confidence: match.confidence,
      reason: match.reason,
    }))
    return { skillName: 'stock.match', ok: true, data: { matches } }
  },
}

export const stockGetHoldingSkill: AgentSkill<Record<string, unknown>> = {
  name: 'stock.getHolding',
  description: '读取单只股票的本地持仓、成本、盈亏和备注。',
  inputSchema: { stockId: 'string' },
  requiredScopes: ['stock.read'],
  async execute(args, ctx) {
    const stock = findStock(ctx.stocks, args)
    if (!stock) return { skillName: 'stock.getHolding', ok: false, error: '未找到对应持仓' }
    const summary = calcStockSummary(stock)
    return {
      skillName: 'stock.getHolding',
      ok: true,
      data: {
        stock: {
          id: stock.id,
          code: stock.code,
          name: stock.name,
          market: stock.market,
          note: stock.note ?? '',
        },
        summary: {
          currentHolding: summary.currentHolding,
          avgCostPrice: summary.avgCostPrice,
          realizedPnl: summary.realizedPnl,
          unrealizedPnl: summary.unrealizedPnl,
          totalPnl: summary.totalPnl,
          totalPnlPercent: summary.totalPnlPercent,
          totalCommission: summary.totalCommission,
          totalDividend: summary.totalDividend,
          tradeCount: summary.tradeCount,
        },
      },
    }
  },
}

export const stockGetRecentTradesSkill: AgentSkill<Record<string, unknown>> = {
  name: 'stock.getRecentTrades',
  description: '读取单只股票最近交易记录。',
  inputSchema: { stockId: 'string', limit: 'number' },
  requiredScopes: ['trade.read'],
  async execute(args, ctx) {
    const stock = findStock(ctx.stocks, args)
    if (!stock) return { skillName: 'stock.getRecentTrades', ok: false, error: '未找到对应持仓' }
    const limit = Math.max(1, Math.min(Number(args.limit ?? 8), 30))
    return {
      skillName: 'stock.getRecentTrades',
      ok: true,
      data: {
        stockId: stock.id,
        trades: stock.trades.slice(-limit).map((trade) => ({
          type: trade.type,
          date: trade.date,
          price: trade.price,
          quantity: trade.quantity,
          commission: trade.commission,
          tax: trade.tax,
          netAmount: trade.netAmount,
          note: trade.note ?? '',
        })),
      },
    }
  },
}

export const stockGetQuoteSkill: AgentSkill<Record<string, unknown>> = {
  name: 'stock.getQuote',
  description: '读取单只本地持仓股票的行情和估值数据。',
  inputSchema: { stockId: 'string' },
  requiredScopes: ['quote.read'],
  async execute(args, ctx) {
    const stock = findStock(ctx.stocks, args)
    if (!stock) return { skillName: 'stock.getQuote', ok: false, error: '未找到对应持仓' }
    const quote = await stockPriceService.getQuote(stock.code, stock.market).catch(() => null)
    return { skillName: 'stock.getQuote', ok: true, data: { stockId: stock.id, quote: quoteToContext(quote) } }
  },
}

export const stockGetExternalQuoteSkill: AgentSkill<{ symbol?: string; market?: Market }> = {
  name: 'stock.getExternalQuote',
  description: '读取未持仓股票的行情和估值数据。',
  inputSchema: { symbol: 'string', market: 'Market' },
  requiredScopes: ['quote.read'],
  async execute(args) {
    if (!args.symbol || !args.market) return { skillName: 'stock.getExternalQuote', ok: false, error: '缺少标的代码或市场' }
    const quote = await stockPriceService.getQuote(args.symbol, args.market).catch(() => null)
    return { skillName: 'stock.getExternalQuote', ok: true, data: { symbol: args.symbol, market: args.market, inPortfolio: false, quote: quoteToContext(quote) } }
  },
}

export const stockGetTechnicalSnapshotSkill: AgentSkill<Record<string, unknown>> = {
  name: 'stock.getTechnicalSnapshot',
  description: '读取单只股票的技术指标摘要。',
  inputSchema: { stockId: 'string' },
  requiredScopes: ['quote.read'],
  async execute(args, ctx) {
    const stock = findStock(ctx.stocks, args)
    if (!stock) return { skillName: 'stock.getTechnicalSnapshot', ok: false, error: '未找到对应持仓' }
    const candles = await fetchDailyCandles(stock.code, stock.market)
    return {
      skillName: 'stock.getTechnicalSnapshot',
      ok: true,
      data: {
        stockId: stock.id,
        indicators: buildTechnicalIndicatorSnapshot(candles),
        candleCount: candles.length,
      },
    }
  },
}

export type FinancialsInput = { symbol: string; market: Market }

export type FinancialsData = {
  symbol: string
  market: Market
  earningsDate: string | null
  epsActual: number | null
  epsEstimate: number | null
  epsSurprise: number | null
  revenueGrowth: number | null
  earningsGrowth: number | null
  source: string
  note?: string
}

const FINANCIAL_FIELDS = [
  'earningsQuarterlyGrowth',
  'revenueGrowth',
  'earningsDate',
  'forwardEps',
  'trailingEps',
].join(',')

function toYahooSymbol(symbol: string, market: Market): string {
  switch (market) {
    case 'US': return symbol
    case 'A':
      return symbol.startsWith('6') ? `${symbol}.SS` : `${symbol}.SZ`
    case 'HK':
      return `${symbol.replace(/^0+/, '')}.HK`
    default:
      return symbol
  }
}

async function fetchYahooFinancials(symbol: string, market: Market): Promise<{ ok: boolean; data?: FinancialsData; error?: string; followUpUrl?: string }> {
  const ySymbol = toYahooSymbol(symbol, market)
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ySymbol)}&fields=${FINANCIAL_FIELDS}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'StockTracker/2.0', Accept: 'application/json' },
    })
    if (!res.ok) return { ok: false, error: `Yahoo Finance 请求失败 (${res.status})`, followUpUrl: url }
    const payload = await res.json()
    const result = payload?.quoteResponse?.result?.[0]
    if (!result) return { ok: false, error: '未找到该股票的财报数据', followUpUrl: url }

    const epsActual = result.trailingEps ?? null
    const epsEstimate = result.forwardEps ?? null
    return {
      ok: true,
      data: {
        symbol,
        market,
        earningsDate: Array.isArray(result.earningsDate) ? result.earningsDate[0]?.fmt ?? null : null,
        epsActual,
        epsEstimate,
        epsSurprise: epsActual != null && epsEstimate != null
          ? Number((((epsActual - epsEstimate) / Math.abs(epsEstimate)) * 100).toFixed(2))
          : null,
        revenueGrowth: result.revenueGrowth != null ? Number((result.revenueGrowth * 100).toFixed(2)) : null,
        earningsGrowth: result.earningsQuarterlyGrowth != null ? Number((result.earningsQuarterlyGrowth * 100).toFixed(2)) : null,
        source: 'yahoo-finance',
      },
    }
  } catch {
    return { ok: false, error: '获取财报数据失败', followUpUrl: url }
  }
}

async function fetchAEastmoneyFinancials(symbol: string): Promise<{ ok: boolean; data?: FinancialsData; error?: string }> {
  const secid = symbol.startsWith('6') ? `1.${symbol}` : `0.${symbol}`
  const url = `https://datacenter.eastmoney.com/api/data/v1/get?reportName=RPT_DMSK_FN_MAIN&columns=SECURITY_CODE,SECURITY_NAME_ABBR,NOTICE_DATE,REPORT_DATE,BASIC_EPS,TOTAL_OPERATE_INCOME,TOTAL_OPERATE_INCOME_YOY,NETPROFIT_PARENT_YOY,WEIGHTAVG_ROE&filter=(SECURITY_TYPE_CODE="058001001")(SECURITY_CODE="${symbol}")&pageNumber=1&pageSize=1&sortName=REPORT_DATE&sortType=-1&source=HSF10&client=PC`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'StockTracker/2.0', Accept: 'application/json' },
    })
    if (!res.ok) return { ok: false, error: `东方财富请求失败 (${res.status})` }
    const payload = await res.json()
    const rows = payload?.result?.data
    if (!rows?.length) return { ok: false, error: '东方财富未返回财报数据' }
    const row = rows[0]
    return {
      ok: true,
      data: {
        symbol,
        market: 'A',
        earningsDate: row.NOTICE_DATE ?? null,
        epsActual: row.BASIC_EPS != null ? Number(row.BASIC_EPS) : null,
        epsEstimate: null,
        epsSurprise: null,
        revenueGrowth: row.TOTAL_OPERATE_INCOME_YOY != null ? Number(row.TOTAL_OPERATE_INCOME_YOY) : null,
        earningsGrowth: row.NETPROFIT_PARENT_YOY != null ? Number(row.NETPROFIT_PARENT_YOY) : null,
        source: 'eastmoney',
        note: `报告期：${row.REPORT_DATE ?? '-'}`,
      },
    }
  } catch {
    return { ok: false, error: '东方财富财报请求异常' }
  }
}

export const stockGetFinancialsSkill: AgentSkill<FinancialsInput, FinancialsData> = {
  name: 'stock.getFinancials',
  description: '获取股票最近财报数据（EPS、营收增长等），支持美股/A股/港股。',
  inputSchema: { symbol: 'string', market: 'Market' },
  requiredScopes: ['quote.read', 'network.fetch'],
  async execute(args) {
    const { symbol, market } = args
    if (!symbol) return { skillName: 'stock.getFinancials', ok: false, error: '缺少标的代码' }

    // A 股：优先东方财富（数据更全），再 Yahoo Finance 兜底
    if (market === 'A') {
      const em = await fetchAEastmoneyFinancials(symbol)
      if (em.ok && em.data) return { skillName: 'stock.getFinancials', ok: true, data: em.data }
      // 东方财富失败，尝试 Yahoo Finance
      const yf = await fetchYahooFinancials(symbol, market)
      if (yf.ok && yf.data) return { skillName: 'stock.getFinancials', ok: true, data: yf.data }
      // 全部失败，web.fetch 兜底
      const fallbackUrl = `https://emweb.securities.eastmoney.com/PC_HSF10/FinanceSummary/Index?type=web&code=${symbol.startsWith('6') ? 'SH' : 'SZ'}${symbol}`
      return {
        skillName: 'stock.getFinancials', ok: false, error: em.error || yf.error,
        needsFollowUp: true,
        suggestedSkills: [
          { name: 'web.fetch', args: { url: fallbackUrl, extractPrompt: '从页面中提取最新财报关键数据：每股收益(EPS)、营业收入同比增长率(%)、归母净利润同比增长率(%)、加权ROE(%)' }, reason: '所有内置财报接口均失败，使用网页抓取兜底' },
        ],
      }
    }

    // 美股 / 港股：Yahoo Finance
    const yf = await fetchYahooFinancials(symbol, market)
    if (yf.ok && yf.data) return { skillName: 'stock.getFinancials', ok: true, data: yf.data }
    return {
      skillName: 'stock.getFinancials', ok: false, error: yf.error,
      needsFollowUp: true,
      suggestedSkills: [
        { name: 'web.fetch', args: { url: yf.followUpUrl || `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`, extractPrompt: '提取最新财报关键指标：EPS、营收、同比增长' }, reason: '财报数据抓取失败，使用 web.fetch 兜底' },
      ],
    }
  },
}
