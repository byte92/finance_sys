import { NextResponse } from 'next/server'
import type { Market } from '@/types'

// ==================== Types ====================
type KlineItem = {
  time: number
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type DataSourceSource = 'tencent' | 'stooq' | 'alpha-vantage'

type KlineResponse = {
  candles: KlineItem[]
  source?: string
  interval: string
  range: string
  error?: string
}

// ==================== Constants ====================
const VALID_MARKETS: Market[] = ['A', 'HK', 'US', 'FUND', 'CRYPTO']

const VALID_INTERVALS = ['1d', '5m', '15m', '30m', '60m'] as const
type Interval = (typeof VALID_INTERVALS)[number]

const RANGE_DAYS: Record<string, number> = {
  '1mo': 31,
  '3mo': 93,
  '6mo': 186,
  '1y': 366,
  '3y': 1096,
  '5y': 1827,
  max: Number.POSITIVE_INFINITY,
}

const CONFIG = {
  TIMEOUT: 7000,
  ALPHA_VANTAGE_TIMEOUT: 9000,
  CACHE: 'no-store' as RequestCache,
  MAX_TENCENT_BARS: 2000,
} as const

// ==================== Utility Functions ====================
function toUnix(dateTime: string): number {
  const iso = dateTime.includes('T') ? dateTime : dateTime.replace(' ', 'T')
  const ms = Date.parse(iso.includes('Z') || iso.includes('+') ? iso : `${iso}:00Z`)
  return Math.floor(ms / 1000)
}

function formatKlineItem(
  time: string | number,
  open: number,
  close: number,
  high: number,
  low: number,
  volume: number
): KlineItem | null {
  if (!isFinite(open) || !isFinite(close) || !isFinite(high) || !isFinite(low)) {
    return null
  }
  const ts = typeof time === 'number' ? time : toUnix(`${time} 00:00`)
  const date = typeof time === 'string' ? time.slice(0, 10) : new Date(ts * 1000).toISOString().slice(0, 10)
  return { time: ts, date, open, high, low, close, volume: isFinite(volume) ? volume : 0 }
}

function sortByTime(data: KlineItem[]): KlineItem[] {
  return data.sort((a, b) => a.time - b.time)
}

function filterByRange(data: KlineItem[], days: number): KlineItem[] {
  if (!Number.isFinite(days)) return sortByTime([...data])
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return sortByTime(data.filter((d) => d.time * 1000 >= cutoff))
}

// ==================== Source Chain ====================
function getSourceChain(market: Market, interval: Interval): DataSourceSource[] {
  const isDaily = interval === '1d'
  const isChina = market === 'A' || market === 'HK' || market === 'FUND'

  if (isDaily) {
    if (market === 'US') return ['stooq', 'alpha-vantage']
    if (isChina) return ['tencent', 'alpha-vantage']
    return ['alpha-vantage']
  }
  return isChina ? ['tencent', 'alpha-vantage'] : ['alpha-vantage']
}

// ==================== Symbol Converters ====================
function toTencentCode(code: string, market: Market): string {
  if (market === 'HK') return `hk${code.padStart(5, '0')}`
  if (market === 'A' || market === 'FUND') {
    const c = code.trim()
    return c.startsWith('6') || c.startsWith('5') ? `sh${c}` : `sz${c}`
  }
  return code
}

function toAlphaSymbol(code: string, market: Market): string {
  if (market === 'A' || market === 'FUND') {
    const suffix = code.startsWith('6') || code.startsWith('5') ? '.SS' : '.SZ'
    return `${code}${suffix}`
  }
  if (market === 'HK') return `${code.padStart(4, '0')}.HK`
  return code.toUpperCase()
}

// ==================== Data Fetchers ====================
async function fetchBySource(
  source: DataSourceSource,
  symbol: string,
  market: Market,
  interval: Interval,
  days: number
): Promise<KlineItem[]> {
  const fetchers = {
    tencent: fetchTencentKline,
    stooq: fetchStooqKline,
    'alpha-vantage': fetchAlphaVantageKline,
  }
  return fetchers[source](symbol, market, interval, days)
}

async function fetchTencentKline(
  symbol: string,
  market: Market,
  interval: Interval,
  days: number
): Promise<KlineItem[]> {
  if (market !== 'A' && market !== 'HK' && market !== 'FUND') return []

  const isMinute = interval !== '1d'
  const code = toTencentCode(symbol, market)

  if (isMinute) {
    return fetchTencentMinuteKline(code, interval, days)
  }
  return fetchTencentDailyKline(code)
}

async function fetchTencentDailyKline(code: string): Promise<KlineItem[]> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,800,qfq`
  const res = await fetch(url, { signal: AbortSignal.timeout(CONFIG.TIMEOUT), cache: CONFIG.CACHE })
  if (!res.ok) return []

  const data = await res.json()
  const rows = (data?.data?.[code]?.qfqday ?? data?.data?.[code]?.day ?? []) as string[][]

  const items = rows
    .map((row) => formatKlineItem(row?.[0], Number(row?.[1]), Number(row?.[2]), Number(row?.[3]), Number(row?.[4]), Number(row?.[5])))
    .filter((item): item is KlineItem => item !== null)

  return sortByTime(items)
}

async function fetchTencentMinuteKline(code: string, interval: Interval, days: number): Promise<KlineItem[]> {
  const gtInterval = interval === '60m' ? 'm60' : `m${interval.replace('m', '')}`
  const barsPerDay = interval === '5m' ? 48 : interval === '15m' ? 16 : interval === '30m' ? 8 : 4
  const safeDays = Number.isFinite(days) ? Math.max(7, Math.min(days, 370)) : 180
  const bars = Math.min(CONFIG.MAX_TENCENT_BARS, safeDays * barsPerDay)

  const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${code},${gtInterval},,${bars}`
  const res = await fetch(url, { signal: AbortSignal.timeout(CONFIG.TIMEOUT), cache: CONFIG.CACHE })
  if (!res.ok) return []

  const data = await res.json()
  const rows = (data?.data?.[code]?.[gtInterval] ?? []) as Array<[string, string, string, string, string, string]>

  const items = rows
    .map((row) => {
      const raw = row?.[0]
      if (!raw?.length || raw.length !== 12) return null

      const dt = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}`
      const item = formatKlineItem(dt, Number(row?.[1]), Number(row?.[2]), Number(row?.[3]), Number(row?.[4]), Number(row?.[5]))
      return item ? { ...item, date: dt.slice(0, 10), time: toUnix(dt) } : null
    })
    .filter((item): item is KlineItem => item !== null)

  return sortByTime(items)
}

async function fetchStooqKline(symbol: string, market: Market): Promise<KlineItem[]> {
  if (market !== 'US') return []

  const std = `${symbol.trim().toLowerCase()}.us`
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(std)}&i=d`
  const res = await fetch(url, { signal: AbortSignal.timeout(CONFIG.TIMEOUT), cache: CONFIG.CACHE })
  if (!res.ok) return []

  const text = await res.text()
  const lines = text.trim().split('\n').slice(1) // Skip header

  const items: KlineItem[] = []
  for (const line of lines) {
    const [date, openS, highS, lowS, closeS, volS] = line.split(',')
    const item = formatKlineItem(date, Number(openS), Number(closeS), Number(highS), Number(lowS), Number(volS))
    if (item) items.push(item)
  }

  return sortByTime(items)
}

async function fetchAlphaVantageKline(
  symbol: string,
  market: Market,
  interval: Interval
): Promise<KlineItem[]> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY ?? process.env.NEXT_PUBLIC_ALPHA_VANTAGE_API_KEY ?? ''
  if (!apiKey) return []

  const std = toAlphaSymbol(symbol, market)
  const isMinute = interval !== '1d'
  const baseUrl = 'https://www.alphavantage.co/query'

  const params = new URLSearchParams({
    symbol: std,
    outputsize: 'full',
    apikey: apiKey,
  })

  if (isMinute) {
    params.set('function', 'TIME_SERIES_INTRADAY')
    params.set('interval', interval)
  } else {
    params.set('function', 'TIME_SERIES_DAILY_ADJUSTED')
  }

  const res = await fetch(`${baseUrl}?${params}`, { signal: AbortSignal.timeout(CONFIG.ALPHA_VANTAGE_TIMEOUT), cache: CONFIG.CACHE })
  if (!res.ok) return []

  const data = await res.json()
  const seriesKey = isMinute ? `Time Series (${interval})` : 'Time Series (Daily)'
  const series = data?.[seriesKey]

  if (!series || typeof series !== 'object') return []

  const items: KlineItem[] = []
  for (const [time, value] of Object.entries(series)) {
    const item = value as Record<string, string>
    const parsed = formatKlineItem(
      time,
      Number(item['1. open']),
      Number(item['4. close']),
      Number(item['2. high']),
      Number(item['3. low']),
      Number(item['6. volume'] ?? item['5. volume'])
    )
    if (parsed) {
      items.push({ ...parsed, date: time.slice(0, 10), time: toUnix(time) })
    }
  }

  return sortByTime(items)
}

// ==================== Route Handler ====================
export async function GET(request: Request): Promise<NextResponse<KlineResponse>> {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim()
  const market = searchParams.get('market') as Market | null
  const range = searchParams.get('range') || '6mo'
  const interval = (searchParams.get('interval') || '1d') as Interval

  // Validation
  if (!symbol) {
    return NextResponse.json({ candles: [], interval, range, error: 'Missing query param: symbol' }, { status: 400 })
  }
  if (!market || !VALID_MARKETS.includes(market)) {
    return NextResponse.json({ candles: [], interval, range, error: 'Invalid query param: market' }, { status: 400 })
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json({ candles: [], interval, range, error: 'Invalid interval. Use 1d/5m/15m/30m/60m' }, { status: 400 })
  }

  const days = RANGE_DAYS[range] ?? RANGE_DAYS['6mo']
  const sourceChain = getSourceChain(market, interval)

  // Try each data source in order
  for (const source of sourceChain) {
    try {
      const data = await fetchBySource(source, symbol, market, interval, days)
      const filtered = filterByRange(data, days)
      if (filtered.length >= 2) {
        return NextResponse.json({ candles: filtered, source, interval, range })
      }
    } catch {
      continue
    }
  }

  return NextResponse.json({ candles: [], interval, range, error: '暂无K线数据' }, { status: 404 })
}
