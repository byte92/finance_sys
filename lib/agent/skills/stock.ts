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

export const stockGetFinancialsSkill: AgentSkill<FinancialsInput, FinancialsData> = {
  name: 'stock.getFinancials',
  description: '获取股票最近财报数据（EPS、营收增长等），首版仅支持美股。',
  inputSchema: { symbol: 'string', market: 'Market' },
  requiredScopes: ['quote.read', 'network.fetch'],
  async execute(args) {
    const { symbol, market } = args
    if (!symbol) return { skillName: 'stock.getFinancials', ok: false, error: '缺少标的代码' }

    // 首版仅支持美股（Yahoo Finance）
    if (market === 'US') {
      try {
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&fields=${FINANCIAL_FIELDS}`
        const res = await fetch(url, {
          headers: { 'User-Agent': 'StockTracker/2.0', Accept: 'application/json' },
        })

        if (!res.ok) {
          return {
            skillName: 'stock.getFinancials',
            ok: false,
            error: `Yahoo Finance 请求失败 (${res.status})`,
            needsFollowUp: true,
            suggestedSkills: [
              { name: 'web.fetch', args: { url, extractPrompt: '提取财报关键数据：EPS、营收同比增长、盈利同比增长' }, reason: 'Yahoo Finance 直接请求失败，用 web.fetch 兜底' },
            ],
          }
        }

        const payload = await res.json()
        const result = payload?.quoteResponse?.result?.[0]
        if (!result) {
          return {
            skillName: 'stock.getFinancials',
            ok: false,
            error: '未找到该股票的数据',
            needsFollowUp: true,
            suggestedSkills: [
              { name: 'web.fetch', args: { url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`, extractPrompt: '提取最新财报关键指标' }, reason: 'Yahoo Finance API 无数据，尝试网页抓取' },
            ],
          }
        }

        const epsActual = result.trailingEps ?? null
        const epsEstimate = result.forwardEps ?? null
        const epsSurprise = epsActual != null && epsEstimate != null
          ? Number((((epsActual - epsEstimate) / Math.abs(epsEstimate)) * 100).toFixed(2))
          : null

        return {
          skillName: 'stock.getFinancials',
          ok: true,
          data: {
            symbol,
            market,
            earningsDate: Array.isArray(result.earningsDate) ? result.earningsDate[0]?.fmt ?? null : null,
            epsActual,
            epsEstimate,
            epsSurprise,
            revenueGrowth: result.revenueGrowth != null ? Number((result.revenueGrowth * 100).toFixed(2)) : null,
            earningsGrowth: result.earningsQuarterlyGrowth != null ? Number((result.earningsQuarterlyGrowth * 100).toFixed(2)) : null,
            source: 'yahoo-finance',
          },
        }
      } catch {
        return {
          skillName: 'stock.getFinancials',
          ok: false,
          error: '获取财报数据失败',
          needsFollowUp: true,
          suggestedSkills: [
            { name: 'web.fetch', args: { url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`, extractPrompt: '提取最新财报关键指标：EPS、营收、同比增长' }, reason: '财报数据抓取失败，使用 web.fetch 兜底' },
          ],
        }
      }
    }

    // A 股 / 港股 / 其他市场：通过 web.fetch 兜底
    return {
      skillName: 'stock.getFinancials',
      ok: false,
      error: `当前市场 ${market} 的财报数据暂不支持内置抓取`,
      needsFollowUp: true,
      suggestedSkills: [
        { name: 'web.fetch', args: { url: market === 'A' ? `https://push2.eastmoney.com/api/qt/stock/get?secid=1.${encodeURIComponent(symbol)}&fields=f183,f184,f185,f186,f187,f188` : `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`, extractPrompt: '提取最新财报关键指标：EPS、营收、同比增长、下季度指引' }, reason: market === 'A' ? '使用东方财富接口抓取 A 股财报' : '使用 Yahoo Finance 网页抓取财报' },
      ],
    }
  },
}
