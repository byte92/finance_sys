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
  requiredScopes: ['stock.read', 'quote.read'],
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
    const quote = await stockPriceService.getQuote(stock.code, stock.market).catch(() => null)
    const summary = calcStockSummary(stock, quote?.price)
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
          marketPrice: quote?.price ?? null,
          marketValue: quote?.price ? Number((summary.currentHolding * quote.price).toFixed(2)) : null,
          realizedPnl: summary.realizedPnl,
          unrealizedPnl: summary.unrealizedPnl,
          totalPnl: summary.totalPnl,
          totalPnlPercent: summary.totalPnlPercent,
          totalCommission: summary.totalCommission,
          totalDividend: summary.totalDividend,
          tradeCount: summary.tradeCount,
          pnlIncludesMarketPrice: Boolean(quote?.price),
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
  async execute(args, ctx) {
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

function parseMoneyWan(value: string | undefined) {
  if (!value) return null
  const normalized = value.replace(/,/g, '').trim()
  if (!normalized || normalized === '--') return null
  const amountWan = Number(normalized)
  return Number.isFinite(amountWan) ? amountWan * 10_000 : null
}

function parseNumberValue(value: string | undefined) {
  if (!value) return null
  const normalized = value.replace(/,/g, '').trim()
  if (!normalized || normalized === '--') return null
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

function growthPercent(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(2))
}

function extractFinancialRow(text: string, label: string, count: number) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.match(new RegExp(`${escaped}\\s+((?:[-\\d,.]+\\s+){1,${count}})`, 'i'))
  return match?.[1]?.trim().split(/\s+/).slice(0, count) ?? []
}

async function fetchSinaAStockFinancials(symbol: string): Promise<FinancialsData | null> {
  const iconv = await import('iconv-lite')
  const url = `https://vip.stock.finance.sina.com.cn/corp/go.php/vFD_ProfitStatement/stockid/${encodeURIComponent(symbol)}/ctrl/part/displaytype/4.phtml`
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return null

  const buffer = Buffer.from(await res.arrayBuffer())
  const html = iconv.decode(buffer, 'gb18030')
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const dates = Array.from(text.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)).map((match) => match[0]).slice(0, 5)
  if (!dates.length) return null

  const revenueValues = extractFinancialRow(text, '一、营业收入', dates.length)
  const netProfitValues = extractFinancialRow(text, '归属于母公司的净利润', dates.length)
  const epsValues = extractFinancialRow(text, '基本每股收益(元/股)', dates.length)
  const currentRevenue = parseMoneyWan(revenueValues[0])
  const previousRevenue = parseMoneyWan(revenueValues[4] ?? revenueValues[1])
  const currentNetProfit = parseMoneyWan(netProfitValues[0])
  const previousNetProfit = parseMoneyWan(netProfitValues[4] ?? netProfitValues[1])
  const epsActual = parseNumberValue(epsValues[0])

  if (currentRevenue === null && currentNetProfit === null && epsActual === null) return null

  return {
    symbol,
    market: 'A',
    earningsDate: dates[0] ?? null,
    epsActual,
    epsEstimate: null,
    epsSurprise: null,
    revenueGrowth: growthPercent(currentRevenue, previousRevenue),
    earningsGrowth: growthPercent(currentNetProfit, previousNetProfit),
    source: 'sina-finance-profit-statement',
    note: [
      currentRevenue !== null ? `营业收入 ${currentRevenue} 元` : '',
      currentNetProfit !== null ? `归母净利润 ${currentNetProfit} 元` : '',
      epsActual !== null ? `基本每股收益 ${epsActual} 元/股` : '',
      dates[0] ? `报告期 ${dates[0]}` : '',
    ].filter(Boolean).join('；'),
  }
}

export const stockGetFinancialsSkill: AgentSkill<FinancialsInput, FinancialsData> = {
  name: 'stock.getFinancials',
  description: '获取股票最近财报数据（EPS、营收增长等），支持美股/A股/港股。',
  inputSchema: { symbol: 'string', market: 'Market' },
  requiredScopes: ['quote.read', 'network.fetch'],
  async execute(args, ctx) {
    const { symbol, market } = args
    if (!symbol) return { skillName: 'stock.getFinancials', ok: false, error: '缺少标的代码' }
    const stock = ctx.stocks.find((item) => item.code === symbol || item.code.toUpperCase() === String(symbol).toUpperCase())
    const displayName = stock?.name ? `${stock.name} ${symbol}` : String(symbol)
    const year = new Date().getFullYear()

    // A 股：通过 Google 搜索最新财报
    if (market === 'A') {
      const financials = await fetchSinaAStockFinancials(String(symbol)).catch(() => null)
      if (financials) {
        return {
          skillName: 'stock.getFinancials',
          ok: true,
          data: financials,
        }
      }

      return {
        skillName: 'stock.getFinancials',
        ok: false,
        error: 'A 股财报需通过搜索引擎查找',
        needsFollowUp: true,
        suggestedSkills: [
          { name: 'web.search', args: { query: `${displayName} ${year} 最新财报 一季报 营业收入 净利润 同比增长`, limit: 5 }, reason: '通过搜索引擎查找该股票最新财报信息' },
        ],
      }
    }

    // 美股 / 港股：Google 搜索英文财报
    return {
      skillName: 'stock.getFinancials',
      ok: false,
      error: '美股/港股财报需通过搜索引擎查找',
      needsFollowUp: true,
      suggestedSkills: [
        { name: 'web.search', args: { query: `${displayName} ${year} latest quarterly earnings EPS revenue net income`, limit: 5 }, reason: '通过搜索引擎查找该股票最新财报信息' },
      ],
    }
  },
}
