// Yahoo Finance 数据源实现（免费，无需API key）
import type { StockDataSource, StockQuote, DataSourceConfig } from '@/types/stockApi'
import type { Market } from '@/types'
import { THIRD_PARTY_REQUEST_HEADERS, thirdPartyApiUrls } from '@/lib/external/thirdPartyApis'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string
        symbol?: string
        regularMarketPrice?: number
        previousClose?: number
        chartPreviousClose?: number
        regularMarketVolume?: number
        regularMarketTime?: number
      }
    }>
  }
}

/**
 * Yahoo Finance 行情数据源，负责获取 Yahoo 报价数据，并在 quote 接口不可用时回退到 chart 接口。
 */
export class YahooFinanceSource implements StockDataSource {
  provider = 'yahoo-finance' as const
  config: DataSourceConfig

  constructor(config: DataSourceConfig) { this.config = config }

  requiresApiKey() { return false }

  async healthCheck(): Promise<boolean> {
    return (await this.getQuote('AAPL', 'US')) !== null
  }

  async getQuote(symbol: string, market: Market): Promise<StockQuote | null> {
    try {
      const std = toYahooSymbol(symbol, market)
      const query = `symbols=${encodeURIComponent(std)}&fields=regularMarketPrice,previousClose,regularMarketChange,regularMarketChangePercent,regularMarketVolume,regularMarketTime,longName,trailingPE,epsTrailingTwelveMonths,priceToBook,marketCap`
      const result = await this.fetchFirstQuoteResult(query)
      if (!result) {
        return this.fetchChartQuote(symbol, market, std)
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
        peTtm: parseOptionalNumber(result.trailingPE),
        epsTtm: parseOptionalNumber(result.epsTrailingTwelveMonths),
        pb: parseOptionalNumber(result.priceToBook),
        marketCap: parseOptionalNumber(result.marketCap),
        valuationSource: 'yahoo-finance',
        timestamp: formatYahooTimestamp(result.regularMarketTime),
        currency: getCurrency(market),
        source: 'yahoo-finance',
      }
    } catch (e) {
      logger.warn('quote.yahoo.getQuote.failed', { error: e, symbol, market })
      return null
    }
  }

  async getBatchQuotes(symbols: string[], market: Market): Promise<StockQuote[]> {
    try {
      const stdSymbols = symbols.map(s => toYahooSymbol(s, market))
      const query = `symbols=${encodeURIComponent(stdSymbols.join(','))}&fields=regularMarketPrice,previousClose,regularMarketChange,regularMarketChangePercent,regularMarketVolume,regularMarketTime,longName,trailingPE,epsTrailingTwelveMonths,priceToBook,marketCap`
      const results = await this.fetchQuoteResults(query)
      if (!results.length) {
        const fallbackResults: StockQuote[] = []
        for (const symbol of symbols) {
          const quote = await this.getQuote(symbol, market)
          if (quote) fallbackResults.push(quote)
        }
        return fallbackResults
      }
      
      return results
        .filter((r: any) => r.regularMarketPrice !== null && r.regularMarketPrice !== undefined)
        .map((r: any) => ({
          symbol: r.symbol,
          name: r.longName || r.symbol,
          price: r.regularMarketPrice,
          change: r.regularMarketChange || 0,
          changePercent: r.regularMarketChangePercent || 0,
          volume: r.regularMarketVolume || 0,
          peTtm: parseOptionalNumber(r.trailingPE),
          epsTtm: parseOptionalNumber(r.epsTrailingTwelveMonths),
          pb: parseOptionalNumber(r.priceToBook),
          marketCap: parseOptionalNumber(r.marketCap),
          valuationSource: 'yahoo-finance',
          timestamp: formatYahooTimestamp(r.regularMarketTime),
          currency: getCurrency(market),
          source: 'yahoo-finance',
        }))
    } catch (e) {
      logger.warn('quote.yahoo.getBatchQuotes.failed', { error: e, count: symbols.length, market })
      return []
    }
  }

  private async fetchFirstQuoteResult(query: string): Promise<any | null> {
    const results = await this.fetchQuoteResults(query)
    return results[0] ?? null
  }

  private async fetchQuoteResults(query: string): Promise<any[]> {
    for (const url of thirdPartyApiUrls.yahooQuoteUrls(query)) {
      try {
        const providerHost = new URL(url).host
        const res = await loggedFetch(url, {
          headers: THIRD_PARTY_REQUEST_HEADERS.yahooFinance,
          signal: AbortSignal.timeout(6000),
          cache: 'no-store',
        }, {
          operation: 'quote.yahoo.fetchQuoteResults',
          provider: this.provider,
          resource: providerHost,
        })
        if (!res.ok) {
          if (res.status === 429 || res.status >= 500) continue
          return []
        }
        const data = await res.json()
        const list = data?.quoteResponse?.result
        if (Array.isArray(list) && list.length > 0) return list
      } catch (error) {
        logger.warn('quote.yahoo.fetchQuoteResults.failed', { error, providerHost: new URL(url).host })
        continue
      }
    }
    return []
  }

  private async fetchChartQuote(symbol: string, market: Market, yahooSymbol: string): Promise<StockQuote | null> {
    try {
      const res = await loggedFetch(thirdPartyApiUrls.yahooChart(yahooSymbol), {
        headers: THIRD_PARTY_REQUEST_HEADERS.yahooFinance,
        signal: AbortSignal.timeout(6000),
        cache: 'no-store',
      }, {
        operation: 'quote.yahoo.fetchChartQuote',
        provider: this.provider,
        resource: yahooSymbol,
        metadata: { symbol, market },
      })
      if (!res.ok) return null

      const payload = await res.json() as YahooChartResponse
      const meta = payload?.chart?.result?.[0]?.meta
      const price = meta?.regularMarketPrice
      const previousClose = meta?.previousClose ?? meta?.chartPreviousClose
      if (!Number.isFinite(price) || !price || price <= 0) return null

      const change = Number.isFinite(previousClose) && previousClose ? price - previousClose : 0
      const changePercent = previousClose ? (change / previousClose) * 100 : 0
      const timestamp = meta?.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString()

      return {
        symbol,
        name: meta?.symbol || symbol,
        price,
        change,
        changePercent,
        volume: meta?.regularMarketVolume ?? 0,
        timestamp,
        currency: meta?.currency || getCurrency(market),
        source: 'yahoo-finance-chart',
      }
    } catch (error) {
      logger.warn('quote.yahoo.fetchChartQuote.failed', { error, symbol, market, yahooSymbol })
      return null
    }
  }
}

function parseOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatYahooTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : new Date().toISOString()
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
