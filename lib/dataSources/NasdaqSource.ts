import type { StockDataSource, StockQuote, DataSourceConfig } from '@/types/stockApi'
import type { Market } from '@/types'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'

const API_BASE = 'https://api.nasdaq.com/api/quote'
const REQUEST_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://www.nasdaq.com',
  'Referer': 'https://www.nasdaq.com/',
  'User-Agent': 'Mozilla/5.0',
} as const

type NasdaqChartPoint = {
  x?: number
  y?: number | string
}

type NasdaqChartResponse = {
  data?: {
    symbol?: string
    company?: string
    timeAsOf?: string
    lastSalePrice?: string
    netChange?: string
    percentageChange?: string
    previousClose?: string
    volume?: string
    chart?: NasdaqChartPoint[]
  } | null
}

/**
 * Nasdaq 行情数据源，负责获取美股实时/延时报价，并把 Nasdaq 响应归一化为系统统一报价结构。
 */
export class NasdaqSource implements StockDataSource {
  provider = 'nasdaq' as const
  config: DataSourceConfig

  constructor(config: DataSourceConfig) {
    this.config = config
  }

  requiresApiKey() { return false }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await loggedFetch(`${API_BASE}/AAPL/chart?assetclass=stocks`, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      }, {
        operation: 'quote.nasdaq.healthCheck',
        provider: this.provider,
        resource: 'AAPL',
      })
      return res.ok
    } catch {
      return false
    }
  }

  async getQuote(symbol: string, market: Market): Promise<StockQuote | null> {
    if (market !== 'US') return null

    try {
      const res = await loggedFetch(`${API_BASE}/${encodeURIComponent(symbol.toUpperCase())}/chart?assetclass=stocks`, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(7000),
        cache: 'no-store',
      }, {
        operation: 'quote.nasdaq.getQuote',
        provider: this.provider,
        resource: symbol.toUpperCase(),
        metadata: { symbol, market },
      })
      if (!res.ok) return null

      const payload = await res.json() as NasdaqChartResponse
      const data = payload?.data
      if (!data) return null

      const price = parseMoney(data.lastSalePrice) ?? getLastChartValue(data.chart)
      if (!price || !Number.isFinite(price)) return null

      const previousClose = parseMoney(data.previousClose)
      const change = parseSignedNumber(data.netChange) ?? (previousClose ? price - previousClose : 0)
      const changePercent = parseSignedNumber(data.percentageChange?.replace('%', ''))
        ?? (previousClose ? (change / previousClose) * 100 : 0)
      const volume = parseLooseNumber(data.volume)
      const sessionLabel = inferUsSession(data.timeAsOf)

      return {
        symbol,
        name: data.company || symbol.toUpperCase(),
        price,
        change: Number.isFinite(change) ? change : 0,
        changePercent: Number.isFinite(changePercent) ? changePercent : 0,
        volume: Number.isFinite(volume) ? volume : 0,
        timestamp: formatNasdaqTimestamp(data.timeAsOf),
        currency: 'USD',
        source: sessionLabel ? `nasdaq-${sessionLabel}` : 'nasdaq',
      }
    } catch (error) {
      logger.warn('quote.nasdaq.getQuote.failed', { error, symbol, market })
      return null
    }
  }

  async getBatchQuotes(symbols: string[], market: Market): Promise<StockQuote[]> {
    const results: StockQuote[] = []
    for (const symbol of symbols) {
      const quote = await this.getQuote(symbol, market)
      if (quote) results.push(quote)
    }
    return results
  }
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value.replace(/[$,]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function parseSignedNumber(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value.replace(/[%,$,]/g, '').replace(/\+/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function parseLooseNumber(value: string | undefined): number {
  if (!value) return 0
  const parsed = Number(value.replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function getLastChartValue(chart: NasdaqChartPoint[] | undefined): number | null {
  if (!Array.isArray(chart) || chart.length === 0) return null
  const last = [...chart].reverse().find((item) => item.y !== undefined && item.y !== null)
  if (!last) return null
  const parsed = Number(last.y)
  return Number.isFinite(parsed) ? parsed : null
}

function inferUsSession(timeAsOf: string | undefined): string | null {
  if (!timeAsOf) return null
  const match = timeAsOf.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*ET/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2])
  const ap = match[3].toUpperCase()
  if (ap === 'PM' && hour !== 12) hour += 12
  if (ap === 'AM' && hour === 12) hour = 0
  const totalMinutes = hour * 60 + minute
  const premarketStart = 4 * 60
  const regularStart = 9 * 60 + 30
  const regularEnd = 16 * 60
  const afterHoursEnd = 20 * 60

  if (totalMinutes >= premarketStart && totalMinutes < regularStart) return '盘前'
  if (totalMinutes >= regularStart && totalMinutes <= regularEnd) return '盘中'
  if (totalMinutes > regularEnd && totalMinutes <= afterHoursEnd) return '盘后'
  return '延时'
}

function formatNasdaqTimestamp(timeAsOf: string | undefined): string {
  if (!timeAsOf) return new Date().toISOString()
  return timeAsOf
}
