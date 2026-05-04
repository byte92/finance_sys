import { NextResponse } from 'next/server'
import { parseMarket } from '@/config/defaults'
import { NEXT_API_ROUTES } from '@/lib/api/endpoints'
import { stockPriceService } from '@/lib/StockPriceService'
import { YahooFinanceSource } from '@/lib/dataSources/YahooFinanceSource'
import { withApiLogging } from '@/lib/observability/api'
import { logger } from '@/lib/observability/logger'
import type { Market } from '@/types'
import type { StockQuote } from '@/types/stockApi'

const yahooValuationSource = new YahooFinanceSource({ provider: 'yahoo-finance' })

async function handleGET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim()
  const market = parseMarket(searchParams.get('market'))
  const forceRefresh = searchParams.get('forceRefresh') === '1'

  if (!symbol) {
    return NextResponse.json({ error: 'Missing query param: symbol' }, { status: 400 })
  }

  if (!market) {
    return NextResponse.json({ error: 'Invalid query param: market' }, { status: 400 })
  }

  if (forceRefresh) {
    stockPriceService.clearCache(symbol, market)
  }

  try {
    const baseQuote = await stockPriceService.getQuote(symbol, market)
    const quote = await enrichQuoteWithValuation(baseQuote, symbol, market)
    if (!quote) {
      return NextResponse.json({ quote: null, error: '暂无行情数据' }, { status: 404 })
    }
    return NextResponse.json({ quote })
  } catch (error) {
    logger.error('api.stock.quote.failed', { error, symbol, market })
    return NextResponse.json({ error: '获取行情失败' }, { status: 500 })
  }
}

export const GET = withApiLogging(NEXT_API_ROUTES.stock.quote, handleGET)

async function enrichQuoteWithValuation(
  quote: StockQuote | null,
  symbol: string,
  market: Market,
): Promise<StockQuote | null> {
  if (!quote) return null
  if (market === 'FUND' || market === 'CRYPTO') return quote
  if (hasValuationData(quote)) return quote

  try {
    const yahooQuote = await yahooValuationSource.getQuote(symbol, market)
    if (!yahooQuote) return quote
    return {
      ...quote,
      peTtm: yahooQuote.peTtm ?? quote.peTtm ?? null,
      epsTtm: yahooQuote.epsTtm ?? quote.epsTtm ?? null,
      pb: yahooQuote.pb ?? quote.pb ?? null,
      marketCap: yahooQuote.marketCap ?? quote.marketCap ?? null,
      valuationSource: yahooQuote.valuationSource ?? quote.valuationSource,
    }
  } catch {
    return quote
  }
}

function hasValuationData(quote: StockQuote) {
  return (
    quote.peTtm !== undefined ||
    quote.epsTtm !== undefined ||
    quote.pb !== undefined ||
    quote.marketCap !== undefined
  )
}
