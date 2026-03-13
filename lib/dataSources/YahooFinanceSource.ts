// Yahoo Finance 数据源实现（免费，无需API key）
import type { StockDataSource, StockQuote, DataSourceConfig } from '@/types/stockApi'
import type { Market } from '@/types'

const API_BASES = [
  'https://query1.finance.yahoo.com/v7/finance/quote',
  'https://query2.finance.yahoo.com/v7/finance/quote',
]

export class YahooFinanceSource implements StockDataSource {
  provider = 'yahoo-finance' as const
  config: DataSourceConfig

  constructor(config: DataSourceConfig) { this.config = config }

  requiresApiKey() { return false }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASES[0]}?symbols=AAPL`, {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      })
      return res.ok
    } catch { return false }
  }

  async getQuote(symbol: string, market: Market): Promise<StockQuote | null> {
    try {
      const std = toYahooSymbol(symbol, market)
      const query = `symbols=${encodeURIComponent(std)}&fields=regularMarketPrice,previousClose,regularMarketChange,regularMarketChangePercent,regularMarketVolume,longName`
      const result = await this.fetchFirstQuoteResult(query)
      if (!result) {
        return null
      }

      const price = result.regularMarketPrice
      const prevClose = result.previousClose
      const change = result.regularMarketChange
      const changePercent = result.regularMarketChangePercent
      const volume = result.regularMarketVolume

      if (!price || price === null || price === undefined) {
        return null
      }

      return {
        symbol,
        name: result.longName || symbol,
        price,
        change: change || 0,
        changePercent: changePercent || 0,
        volume: volume || 0,
        timestamp: new Date().toISOString(),
        currency: getCurrency(market),
        source: 'yahoo-finance',
      }
    } catch (e) {
      console.warn('[YahooFinanceSource] Error:', e)
      return null
    }
  }

  async getBatchQuotes(symbols: string[], market: Market): Promise<StockQuote[]> {
    try {
      const stdSymbols = symbols.map(s => toYahooSymbol(s, market))
      const query = `symbols=${encodeURIComponent(stdSymbols.join(','))}&fields=regularMarketPrice,previousClose,regularMarketChange,regularMarketChangePercent,regularMarketVolume,longName`
      const results = await this.fetchQuoteResults(query)
      if (!results.length) return []
      
      return results
        .filter((r: any) => r.regularMarketPrice !== null && r.regularMarketPrice !== undefined)
        .map((r: any) => ({
          symbol: r.symbol,
          name: r.longName || r.symbol,
          price: r.regularMarketPrice,
          change: r.regularMarketChange || 0,
          changePercent: r.regularMarketChangePercent || 0,
          volume: r.regularMarketVolume || 0,
          timestamp: new Date().toISOString(),
          currency: getCurrency(market),
          source: 'yahoo-finance',
        }))
    } catch (e) {
      console.warn('[YahooFinanceSource] Batch error:', e)
      return []
    }
  }

  private async fetchFirstQuoteResult(query: string): Promise<any | null> {
    const results = await this.fetchQuoteResults(query)
    return results[0] ?? null
  }

  private async fetchQuoteResults(query: string): Promise<any[]> {
    for (const base of API_BASES) {
      try {
        const res = await fetch(`${base}?${query}`, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0',
          },
          signal: AbortSignal.timeout(6000),
          cache: 'no-store',
        })
        if (!res.ok) {
          if (res.status === 429 || res.status >= 500) continue
          return []
        }
        const data = await res.json()
        const list = data?.quoteResponse?.result
        if (Array.isArray(list) && list.length > 0) return list
      } catch {
        continue
      }
    }
    return []
  }
}

function toYahooSymbol(code: string, market: Market): string {
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
