import { COINBASE_EXCHANGE_BASE, CRYPTO_BINANCE_HOSTS, normalizeCryptoSymbol } from '@/lib/external/cryptoSymbols'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'
import type { Market } from '@/types'
import type { DataSourceConfig, StockDataSource, StockQuote } from '@/types/stockApi'

type BinanceTicker24h = {
  symbol?: string
  priceChange?: string
  priceChangePercent?: string
  lastPrice?: string
  volume?: string
  closeTime?: number
}

type CoinbaseStats = {
  open?: string
  last?: string
  volume?: string
}

/**
 * Crypto 行情数据源，优先使用 USDT 交易对，失败时回退到 Coinbase USD 现货对。
 */
export class CryptoSource implements StockDataSource {
  provider = 'crypto' as const
  config: DataSourceConfig

  constructor(config: DataSourceConfig) {
    this.config = config
  }

  requiresApiKey() { return false }

  async healthCheck(): Promise<boolean> {
    return (await this.getQuote('BTC', 'CRYPTO')) !== null
  }

  async getQuote(symbol: string, market: Market): Promise<StockQuote | null> {
    if (market !== 'CRYPTO') return null

    const normalized = normalizeCryptoSymbol(symbol)
    if (!normalized) return null

    const binanceQuote = await this.fetchBinanceQuote(normalized)
    if (binanceQuote) return binanceQuote

    return this.fetchCoinbaseQuote(normalized)
  }

  async getBatchQuotes(symbols: string[], market: Market): Promise<StockQuote[]> {
    if (market !== 'CRYPTO') return []

    const results: StockQuote[] = []
    for (const symbol of symbols) {
      const quote = await this.getQuote(symbol, market)
      if (quote) results.push(quote)
    }
    return results
  }

  private async fetchBinanceQuote(symbol: NonNullable<ReturnType<typeof normalizeCryptoSymbol>>) {
    for (const baseUrl of CRYPTO_BINANCE_HOSTS) {
      try {
        const url = `${baseUrl}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol.binanceSymbol)}`
        const res = await loggedFetch(url, {
          signal: AbortSignal.timeout(7000),
          cache: 'no-store',
        }, {
          operation: 'quote.crypto.binance24h',
          provider: new URL(baseUrl).host,
          resource: symbol.binanceSymbol,
        })
        if (!res.ok) continue

        const data = await res.json() as BinanceTicker24h
        const price = Number(data.lastPrice)
        if (!Number.isFinite(price) || price <= 0) continue

        return {
          symbol: symbol.baseAsset,
          name: symbol.displayName,
          price,
          change: parseFiniteNumber(data.priceChange) ?? 0,
          changePercent: parseFiniteNumber(data.priceChangePercent) ?? 0,
          volume: parseFiniteNumber(data.volume) ?? 0,
          timestamp: data.closeTime ? new Date(data.closeTime).toISOString() : new Date().toISOString(),
          currency: 'USDT',
          source: new URL(baseUrl).host.includes('binance.us') ? 'binance-us' : 'binance',
        } satisfies StockQuote
      } catch (error) {
        logger.warn('quote.crypto.binance24h.failed', { error, symbol: symbol.binanceSymbol, baseUrl })
      }
    }
    return null
  }

  private async fetchCoinbaseQuote(symbol: NonNullable<ReturnType<typeof normalizeCryptoSymbol>>) {
    try {
      const url = `${COINBASE_EXCHANGE_BASE}/products/${encodeURIComponent(symbol.coinbaseProductId)}/stats`
      const res = await loggedFetch(url, {
        signal: AbortSignal.timeout(7000),
        cache: 'no-store',
      }, {
        operation: 'quote.crypto.coinbaseStats',
        provider: 'coinbase-exchange',
        resource: symbol.coinbaseProductId,
      })
      if (!res.ok) return null

      const data = await res.json() as CoinbaseStats
      const price = Number(data.last)
      const open = Number(data.open)
      if (!Number.isFinite(price) || price <= 0) return null

      const change = Number.isFinite(open) && open > 0 ? price - open : 0
      const changePercent = Number.isFinite(open) && open > 0 ? (change / open) * 100 : 0
      return {
        symbol: symbol.baseAsset,
        name: symbol.displayName,
        price,
        change,
        changePercent,
        volume: parseFiniteNumber(data.volume) ?? 0,
        timestamp: new Date().toISOString(),
        currency: 'USDT',
        source: 'coinbase-usd',
      } satisfies StockQuote
    } catch (error) {
      logger.warn('quote.crypto.coinbaseStats.failed', { error, symbol: symbol.coinbaseProductId })
      return null
    }
  }
}

function parseFiniteNumber(value: string | number | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
