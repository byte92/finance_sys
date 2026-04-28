// Alpha Vantage 数据源实现
import type { StockDataSource, StockQuote, DataSourceConfig } from '@/types/stockApi'
import type { Market } from '@/types'

const API_BASE = 'https://www.alphavantage.co/query'

export class AlphaVantageDataSource implements StockDataSource {
  provider = 'alpha-vantage' as const
  config: DataSourceConfig

  constructor(config: DataSourceConfig) { this.config = config }

  requiresApiKey() { return true }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}?function=GLOBAL_QUOTE&symbol=IBM&apikey=demo`)
      return res.ok
    } catch { return false }
  }

  async getQuote(symbol: string, market: Market): Promise<StockQuote | null> {
    if (!this.config.apiKey) return null
    try {
      const std = toAlphaSymbol(symbol, market)
      const url = `${API_BASE}?function=GLOBAL_QUOTE&symbol=${std}&apikey=${this.config.apiKey}`
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      })
      if (!res.ok) return null
      const data = await res.json()
      if (data['Error Message'] || data['Information'] || data['Note']) return null
      const q = data['Global Quote']
      if (!q || !q['05. price']) return null
      const price = parseFloat(q['05. price'])
      const prevClose = parseFloat(q['08. previous close'])
      const change = price - prevClose
      return {
        symbol, name: q['01. symbol'] || symbol,
        price, change, changePercent: prevClose ? (change / prevClose) * 100 : 0,
        volume: parseInt(q['06. volume']),
        timestamp: q['07. latest trading day'],
        currency: getCurrency(market),
        source: 'alpha-vantage',
      }
    } catch { return null }
  }

  async getBatchQuotes(symbols: string[], market: Market): Promise<StockQuote[]> {
    const results: StockQuote[] = []
    for (const s of symbols) {
      const q = await this.getQuote(s, market)
      if (q) results.push(q)
      await delay(12000) // 5次/分钟限速
    }
    return results
  }
}

function toAlphaSymbol(code: string, market: Market): string {
  if (market === 'A' || market === 'FUND') {
    if (code.startsWith('6') || code.startsWith('5')) return `${code}.SS`
    return `${code}.SZ`
  }
  if (market === 'HK') return `${code.padStart(4, '0')}.HK`
  return code.toUpperCase()
}

function getCurrency(market: Market): string {
  return { A: 'CNY', HK: 'HKD', US: 'USD', FUND: 'CNY', CRYPTO: 'USDT' }[market]
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
