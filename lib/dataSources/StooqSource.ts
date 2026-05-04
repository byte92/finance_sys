import type { StockDataSource, StockQuote, DataSourceConfig } from '@/types/stockApi'
import type { Market } from '@/types'
import { thirdPartyApiUrls } from '@/lib/external/thirdPartyApis'
import { loggedFetch } from '@/lib/observability/fetch'

/**
 * Stooq 行情数据源，负责获取美股 CSV 报价，主要作为美股报价链路的轻量 fallback。
 */
export class StooqSource implements StockDataSource {
  provider = 'stooq' as const
  config: DataSourceConfig

  constructor(config: DataSourceConfig) {
    this.config = config
  }

  requiresApiKey() { return false }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await loggedFetch(thirdPartyApiUrls.stooqQuote('aapl.us', 'd'), {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      }, {
        operation: 'quote.stooq.healthCheck',
        provider: this.provider,
        resource: 'aapl.us',
      })
      return res.ok
    } catch {
      return false
    }
  }

  async getQuote(symbol: string, market: Market): Promise<StockQuote | null> {
    if (market !== 'US') return null

    try {
      const std = `${symbol.trim().toLowerCase()}.us`
      const res = await loggedFetch(thirdPartyApiUrls.stooqQuote(std), {
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      }, {
        operation: 'quote.stooq.getQuote',
        provider: this.provider,
        resource: std,
        metadata: { symbol, market },
      })
      if (!res.ok) return null
      const text = (await res.text()).trim()
      // CSV: SYMBOL,DATE,TIME,OPEN,HIGH,LOW,CLOSE,VOLUME
      const cols = text.split(',')
      if (cols.length < 8) return null
      const close = Number(cols[6])
      const volume = Number(cols[7])
      const tradingDate = cols[1]
      if (!Number.isFinite(close) || close <= 0) return null

      return {
        symbol,
        name: symbol.toUpperCase(),
        price: close,
        change: 0,
        changePercent: 0,
        volume: Number.isFinite(volume) ? volume : undefined,
        timestamp: /^\d{4}-\d{2}-\d{2}$/.test(tradingDate) ? tradingDate : new Date().toISOString(),
        currency: 'USD',
        source: 'stooq',
      }
    } catch {
      return null
    }
  }

  async getBatchQuotes(symbols: string[], market: Market): Promise<StockQuote[]> {
    const results: StockQuote[] = []
    for (const s of symbols) {
      const q = await this.getQuote(s, market)
      if (q) results.push(q)
    }
    return results
  }
}
