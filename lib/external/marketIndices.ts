import { buildTechnicalIndicatorSnapshot } from '@/lib/technicalIndicators'
import type { CandlePoint } from '@/lib/technicalIndicators'
import type { Market, MarketIndexSnapshot, MarketRegion } from '@/types'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'

export type MarketIndexDefinition = {
  id: string
  code: string
  name: string
  region: MarketRegion
  market: Market
  tencentCode: string
}

export const MARKET_INDEX_DEFINITIONS: MarketIndexDefinition[] = [
  { id: 'shanghai-composite', code: '000001', name: '上证指数', region: 'A', market: 'A', tencentCode: 'sh000001' },
  { id: 'shenzhen-component', code: '399001', name: '深证成指', region: 'A', market: 'A', tencentCode: 'sz399001' },
  { id: 'chinext', code: '399006', name: '创业板指', region: 'A', market: 'A', tencentCode: 'sz399006' },
  { id: 'hang-seng', code: 'HSI', name: '恒生指数', region: 'HK', market: 'HK', tencentCode: 'hkHSI' },
  { id: 'hang-seng-tech', code: 'HSTECH', name: '恒生科技指数', region: 'HK', market: 'HK', tencentCode: 'hkHSTECH' },
  { id: 'dow-jones', code: 'DJI', name: '道琼斯', region: 'US', market: 'US', tencentCode: 'usDJI' },
  { id: 'sp500', code: 'SPX', name: '标普500', region: 'US', market: 'US', tencentCode: 'usINX' },
  { id: 'nasdaq', code: 'IXIC', name: '纳斯达克', region: 'US', market: 'US', tencentCode: 'usIXIC' },
]

function parseDateString(date: string, market: Market) {
  if (market === 'US') return `${date}T00:00:00Z`
  return `${date}T00:00:00+08:00`
}

function parseCandleRows(rows: string[][], market: Market): CandlePoint[] {
  return rows
    .map((row) => {
      const date = row?.[0]
      const open = Number(row?.[1])
      const close = Number(row?.[2])
      const high = Number(row?.[3])
      const low = Number(row?.[4])
      const volume = Number(row?.[5])
      if (!date || !Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(high) || !Number.isFinite(low)) return null
      return {
        date,
        time: Math.floor(Date.parse(parseDateString(date, market)) / 1000),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      }
    })
    .filter((item): item is CandlePoint => item !== null)
}

async function fetchIndexRawPayload(definition: MarketIndexDefinition, limit = 120) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${definition.tencentCode},day,,,${limit},qfq`
  const res = await loggedFetch(url, {
    signal: AbortSignal.timeout(7000),
    cache: 'no-store',
  }, {
    operation: 'marketIndex.tencent.snapshot',
    provider: 'tencent',
    resource: definition.tencentCode,
    metadata: { indexId: definition.id, market: definition.market, limit },
  })
  if (!res.ok) throw new Error(`获取 ${definition.name} 数据失败`)
  const data = await res.json()
  return data?.data?.[definition.tencentCode] ?? null
}

export async function fetchMarketIndexSnapshot(definition: MarketIndexDefinition, options: { includeIndicators?: boolean } = {}): Promise<MarketIndexSnapshot | null> {
  try {
    const raw = await fetchIndexRawPayload(definition, options.includeIndicators ? 240 : 2)
    if (!raw) return null

    const rows = (raw.qfqday ?? raw.day ?? []) as string[][]
    const candles = parseCandleRows(rows, definition.market)
    const latest = candles[candles.length - 1]
    const previous = candles[candles.length - 2] ?? null
    const qt = (raw.qt?.[definition.tencentCode] ?? null) as string[] | null

    const price = Number(qt?.[3] ?? latest?.close)
    const previousClose = Number(qt?.[4] ?? previous?.close ?? 0)
    const open = Number(qt?.[5] ?? latest?.open ?? 0)
    const high = Number(qt?.[34] ?? latest?.high ?? 0)
    const low = Number(qt?.[35] ?? latest?.low ?? 0)
    const volume = Number(qt?.[6] ?? latest?.volume ?? 0)
    const change = Number.isFinite(Number(qt?.[32])) ? Number(qt?.[32]) : price - previousClose
    const changePercent = Number.isFinite(Number(qt?.[33])) ? Number(qt?.[33]) : (previousClose > 0 ? (change / previousClose) * 100 : 0)
    const timestamp = qt?.[30] && qt?.[31]
      ? `${String(qt[30]).replace(/\//g, '-')}T${String(qt[31]).slice(0, 2)}:${String(qt[31]).slice(2, 4)}:${String(qt[31]).slice(4, 6)}${definition.market === 'US' ? 'Z' : '+08:00'}`
      : new Date().toISOString()

    if (!Number.isFinite(price) || price <= 0) return null

    return {
      id: definition.id,
      code: definition.code,
      name: String(qt?.[1] ?? definition.name),
      region: definition.region,
      market: definition.market,
      price,
      change,
      changePercent,
      previousClose: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null,
      open: Number.isFinite(open) && open > 0 ? open : null,
      high: Number.isFinite(high) && high > 0 ? high : null,
      low: Number.isFinite(low) && low > 0 ? low : null,
      volume: Number.isFinite(volume) && volume > 0 ? volume : null,
      timestamp,
      currency: definition.market === 'US' ? 'USD' : definition.market === 'HK' ? 'HKD' : 'CNY',
      source: 'tencent',
      indicators: options.includeIndicators ? buildTechnicalIndicatorSnapshot(candles) : undefined,
    }
  } catch (error) {
    logger.warn('marketIndex.snapshot.failed', {
      error,
      indexId: definition.id,
      name: definition.name,
      market: definition.market,
    })
    return null
  }
}
