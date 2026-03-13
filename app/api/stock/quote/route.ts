import { NextResponse } from 'next/server'
import { stockPriceService } from '@/lib/StockPriceService'
import type { Market } from '@/types'

const VALID_MARKETS: Market[] = ['A', 'HK', 'US', 'FUND', 'CRYPTO']

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim()
  const market = searchParams.get('market') as Market | null
  const forceRefresh = searchParams.get('forceRefresh') === '1'

  if (!symbol) {
    return NextResponse.json({ error: 'Missing query param: symbol' }, { status: 400 })
  }

  if (!market || !VALID_MARKETS.includes(market)) {
    return NextResponse.json({ error: 'Invalid query param: market' }, { status: 400 })
  }

  if (forceRefresh) {
    stockPriceService.clearCache(symbol, market)
  }

  try {
    const quote = await stockPriceService.getQuote(symbol, market)
    if (!quote) {
      return NextResponse.json({ quote: null, error: '暂无行情数据' }, { status: 404 })
    }
    return NextResponse.json({ quote })
  } catch (error) {
    console.error('[api/stock/quote] failed:', error)
    return NextResponse.json({ error: '获取行情失败' }, { status: 500 })
  }
}
