import { NextResponse } from 'next/server'
import { parseMarket } from '@/config/defaults'
import { NEXT_API_ROUTES } from '@/lib/api/endpoints'
import { fetchKline, VALID_KLINE_INTERVALS, type KlineFetchResult, type KlineInterval } from '@/lib/external/kline'
import { withApiLogging } from '@/lib/observability/api'

async function handleGET(request: Request): Promise<NextResponse<KlineFetchResult>> {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim()
  const market = parseMarket(searchParams.get('market'))
  const range = searchParams.get('range') || '6mo'
  const interval = (searchParams.get('interval') || '1d') as KlineInterval

  if (!symbol) {
    return NextResponse.json({ candles: [], interval, range, error: 'Missing query param: symbol' }, { status: 400 })
  }
  if (!market) {
    return NextResponse.json({ candles: [], interval, range, error: 'Invalid query param: market' }, { status: 400 })
  }
  if (!VALID_KLINE_INTERVALS.includes(interval)) {
    return NextResponse.json({ candles: [], interval, range, error: 'Invalid interval. Use 1d/5m/15m/30m/60m' }, { status: 400 })
  }

  const result = await fetchKline(symbol, market, { interval, range })
  if (result.error) return NextResponse.json(result, { status: 404 })
  return NextResponse.json(result)
}

export const GET = withApiLogging(NEXT_API_ROUTES.stock.kline, handleGET)
