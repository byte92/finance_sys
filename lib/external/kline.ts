import type { Market } from '@/types'
import { COINBASE_EXCHANGE_BASE, CRYPTO_BINANCE_HOSTS, normalizeCryptoSymbol } from '@/lib/external/cryptoSymbols'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'

export type KlineInterval = '1d' | '5m' | '15m' | '30m' | '60m'

export type KlineItem = {
  time: number
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type KlineSource = 'tencent' | 'nasdaq' | 'stooq' | 'alpha-vantage' | 'binance' | 'coinbase'

export type KlineFetchResult = {
  candles: KlineItem[]
  source?: KlineSource
  interval: KlineInterval
  range: string
  error?: string
}

export const VALID_KLINE_INTERVALS = ['1d', '5m', '15m', '30m', '60m'] as const

export const KLINE_RANGE_DAYS: Record<string, number> = {
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
  volume: number,
): KlineItem | null {
  if (!Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(high) || !Number.isFinite(low)) {
    return null
  }
  const ts = typeof time === 'number' ? time : toUnix(`${time} 00:00`)
  const date = typeof time === 'string' ? time.slice(0, 10) : new Date(ts * 1000).toISOString().slice(0, 10)
  return { time: ts, date, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 }
}

function sortByTime(data: KlineItem[]): KlineItem[] {
  return data.sort((a, b) => a.time - b.time)
}

function filterByRange(data: KlineItem[], days: number): KlineItem[] {
  if (!Number.isFinite(days)) return sortByTime([...data])
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return sortByTime(data.filter((item) => item.time * 1000 >= cutoff))
}

function getSourceChain(market: Market, interval: KlineInterval): KlineSource[] {
  const isDaily = interval === '1d'
  const isChina = market === 'A' || market === 'HK' || market === 'FUND'

  if (isDaily) {
    if (market === 'US') return ['nasdaq', 'alpha-vantage']
    if (isChina) return ['tencent', 'alpha-vantage']
    if (market === 'CRYPTO') return ['binance', 'coinbase']
    return ['alpha-vantage']
  }
  if (market === 'CRYPTO') return ['binance', 'coinbase']
  return isChina ? ['tencent', 'alpha-vantage'] : ['alpha-vantage']
}

function toTencentCode(code: string, market: Market): string {
  if (market === 'HK') return `hk${code.padStart(5, '0')}`
  if (market === 'A' || market === 'FUND') {
    const c = code.trim()
    return c.startsWith('6') || c.startsWith('5') ? `sh${c}` : `sz${c}`
  }
  if (market === 'US') return `us${code.trim().toUpperCase()}`
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

async function fetchBySource(source: KlineSource, symbol: string, market: Market, interval: KlineInterval, days: number): Promise<KlineItem[]> {
  const fetchers = {
    tencent: fetchTencentKline,
    nasdaq: fetchNasdaqKline,
    stooq: fetchStooqKline,
    'alpha-vantage': fetchAlphaVantageKline,
    binance: fetchBinanceCryptoKline,
    coinbase: fetchCoinbaseCryptoKline,
  }
  return fetchers[source](symbol, market, interval, days)
}

async function fetchTencentKline(symbol: string, market: Market, interval: KlineInterval, days: number): Promise<KlineItem[]> {
  if (market !== 'A' && market !== 'HK' && market !== 'FUND') return []
  const code = toTencentCode(symbol, market)
  return interval === '1d' ? fetchTencentDailyKline(code) : fetchTencentMinuteKline(code, interval, days)
}

async function fetchTencentDailyKline(code: string, limit = 800): Promise<KlineItem[]> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,${limit},qfq`
  const res = await loggedFetch(url, { signal: AbortSignal.timeout(CONFIG.TIMEOUT), cache: CONFIG.CACHE }, {
    operation: 'kline.tencent.daily',
    provider: 'tencent',
    resource: code,
    metadata: { limit },
  })
  if (!res.ok) return []

  const data = await res.json()
  const rows = (data?.data?.[code]?.qfqday ?? data?.data?.[code]?.day ?? []) as string[][]
  const items = rows
    .map((row) => formatKlineItem(row?.[0], Number(row?.[1]), Number(row?.[2]), Number(row?.[3]), Number(row?.[4]), Number(row?.[5])))
    .filter((item): item is KlineItem => item !== null)

  return sortByTime(items)
}

async function fetchTencentMinuteKline(code: string, interval: KlineInterval, days: number): Promise<KlineItem[]> {
  const gtInterval = interval === '60m' ? 'm60' : `m${interval.replace('m', '')}`
  const barsPerDay = interval === '5m' ? 48 : interval === '15m' ? 16 : interval === '30m' ? 8 : 4
  const safeDays = Number.isFinite(days) ? Math.max(7, Math.min(days, 370)) : 180
  const bars = Math.min(CONFIG.MAX_TENCENT_BARS, safeDays * barsPerDay)
  const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${code},${gtInterval},,${bars}`
  const res = await loggedFetch(url, { signal: AbortSignal.timeout(CONFIG.TIMEOUT), cache: CONFIG.CACHE }, {
    operation: 'kline.tencent.minute',
    provider: 'tencent',
    resource: code,
    metadata: { interval, days, bars },
  })
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
  const res = await loggedFetch(url, { signal: AbortSignal.timeout(CONFIG.TIMEOUT), cache: CONFIG.CACHE }, {
    operation: 'kline.stooq.daily',
    provider: 'stooq',
    resource: std,
    metadata: { symbol, market },
  })
  if (!res.ok) return []

  const text = await res.text()
  const lines = text.trim().split('\n').slice(1)
  const items: KlineItem[] = []
  for (const line of lines) {
    const [date, openS, highS, lowS, closeS, volS] = line.split(',')
    const item = formatKlineItem(date, Number(openS), Number(closeS), Number(highS), Number(lowS), Number(volS))
    if (item) items.push(item)
  }
  return sortByTime(items)
}

async function fetchNasdaqKline(symbol: string, market: Market, interval: KlineInterval, days: number): Promise<KlineItem[]> {
  if (market !== 'US' || interval !== '1d') return []
  const fromDate = formatUsDateForNasdaq(days)
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol.toUpperCase())}/historical?assetclass=stocks&limit=500&fromdate=${fromDate}`
  const res = await loggedFetch(url, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://www.nasdaq.com',
      'Referer': 'https://www.nasdaq.com/',
      'User-Agent': 'Mozilla/5.0',
    },
    signal: AbortSignal.timeout(CONFIG.TIMEOUT),
    cache: CONFIG.CACHE,
  }, {
    operation: 'kline.nasdaq.historical',
    provider: 'nasdaq',
    resource: symbol.toUpperCase(),
    metadata: { symbol, market, days, fromDate },
  })
  if (!res.ok) return []

  const payload = await res.json()
  const rows = payload?.data?.tradesTable?.rows
  if (!Array.isArray(rows)) return []

  const items = rows
    .map((row: Record<string, string>) => {
      const date = parseNasdaqHistoricalDate(row.date)
      if (!date) return null
      return formatKlineItem(
        date,
        parseCurrencyNumber(row.open),
        parseCurrencyNumber(row.close),
        parseCurrencyNumber(row.high),
        parseCurrencyNumber(row.low),
        parseInteger(row.volume),
      )
    })
    .filter((item: KlineItem | null): item is KlineItem => item !== null)

  return sortByTime(items)
}

async function fetchAlphaVantageKline(symbol: string, market: Market, interval: KlineInterval): Promise<KlineItem[]> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY ?? process.env.NEXT_PUBLIC_ALPHA_VANTAGE_API_KEY ?? ''
  if (!apiKey) return []

  const std = toAlphaSymbol(symbol, market)
  const isMinute = interval !== '1d'
  const params = new URLSearchParams({
    symbol: std,
    outputsize: 'full',
    apikey: apiKey,
    function: isMinute ? 'TIME_SERIES_INTRADAY' : 'TIME_SERIES_DAILY_ADJUSTED',
  })
  if (isMinute) params.set('interval', interval)

  const res = await loggedFetch(`https://www.alphavantage.co/query?${params}`, {
    signal: AbortSignal.timeout(CONFIG.ALPHA_VANTAGE_TIMEOUT),
    cache: CONFIG.CACHE,
  }, {
    operation: 'kline.alphaVantage.timeSeries',
    provider: 'alpha-vantage',
    resource: std,
    metadata: { symbol, market, interval, isMinute },
  })
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
      Number(item['6. volume'] ?? item['5. volume']),
    )
    if (parsed) items.push({ ...parsed, date: time.slice(0, 10), time: toUnix(time) })
  }

  return sortByTime(items)
}

async function fetchBinanceCryptoKline(symbol: string, market: Market, interval: KlineInterval, days: number): Promise<KlineItem[]> {
  if (market !== 'CRYPTO') return []
  const normalized = normalizeCryptoSymbol(symbol)
  if (!normalized) return []

  const binanceInterval = interval === '60m' ? '1h' : interval
  const limit = getCryptoKlineLimit(interval, days)

  for (const baseUrl of CRYPTO_BINANCE_HOSTS) {
    try {
      const params = new URLSearchParams({
        symbol: normalized.binanceSymbol,
        interval: binanceInterval,
        limit: String(limit),
      })
      const url = `${baseUrl}/api/v3/klines?${params}`
      const res = await loggedFetch(url, {
        signal: AbortSignal.timeout(CONFIG.TIMEOUT),
        cache: CONFIG.CACHE,
      }, {
        operation: 'kline.crypto.binance',
        provider: new URL(baseUrl).host,
        resource: normalized.binanceSymbol,
        metadata: { interval, days, limit },
      })
      if (!res.ok) continue

      const rows = await res.json() as unknown[]
      if (!Array.isArray(rows)) continue
      const items = rows
        .map((row) => {
          if (!Array.isArray(row)) return null
          const openTime = Number(row[0])
          return formatKlineItem(
            Math.floor(openTime / 1000),
            Number(row[1]),
            Number(row[4]),
            Number(row[2]),
            Number(row[3]),
            Number(row[5]),
          )
        })
        .filter((item): item is KlineItem => item !== null)

      if (items.length) return sortByTime(items)
    } catch (error) {
      logger.warn('kline.crypto.binance.failed', { error, symbol: normalized.binanceSymbol, baseUrl })
    }
  }

  return []
}

async function fetchCoinbaseCryptoKline(symbol: string, market: Market, interval: KlineInterval, days: number): Promise<KlineItem[]> {
  if (market !== 'CRYPTO') return []
  const normalized = normalizeCryptoSymbol(symbol)
  if (!normalized) return []

  const granularity = getCoinbaseGranularity(interval)
  if (!granularity) return []

  const end = new Date()
  const start = new Date(end.getTime() - getCoinbaseRangeMs(interval, days))
  const params = new URLSearchParams({
    granularity: String(granularity),
    start: start.toISOString(),
    end: end.toISOString(),
  })
  const url = `${COINBASE_EXCHANGE_BASE}/products/${encodeURIComponent(normalized.coinbaseProductId)}/candles?${params}`
  const res = await loggedFetch(url, {
    signal: AbortSignal.timeout(CONFIG.TIMEOUT),
    cache: CONFIG.CACHE,
  }, {
    operation: 'kline.crypto.coinbase',
    provider: 'coinbase-exchange',
    resource: normalized.coinbaseProductId,
    metadata: { interval, days, granularity },
  })
  if (!res.ok) return []

  const rows = await res.json() as unknown[]
  if (!Array.isArray(rows)) return []

  const items = rows
    .map((row) => {
      if (!Array.isArray(row)) return null
      return formatKlineItem(
        Number(row[0]),
        Number(row[3]),
        Number(row[4]),
        Number(row[2]),
        Number(row[1]),
        Number(row[5]),
      )
    })
    .filter((item): item is KlineItem => item !== null)

  return sortByTime(items)
}

function getCryptoKlineLimit(interval: KlineInterval, days: number) {
  if (!Number.isFinite(days)) return 1000
  if (interval === '1d') return Math.max(2, Math.min(1000, Math.ceil(days) + 14))

  const barsPerDay = interval === '5m' ? 288 : interval === '15m' ? 96 : interval === '30m' ? 48 : 24
  return Math.max(2, Math.min(1000, Math.ceil(days * barsPerDay)))
}

function getCoinbaseGranularity(interval: KlineInterval) {
  if (interval === '1d') return 86400
  if (interval === '5m') return 300
  if (interval === '15m') return 900
  if (interval === '60m') return 3600
  return null
}

function getCoinbaseRangeMs(interval: KlineInterval, days: number) {
  const granularity = getCoinbaseGranularity(interval)
  if (!granularity || !Number.isFinite(days)) return 300 * 86400 * 1000
  const maxRangeMs = granularity * 300 * 1000
  return Math.min(days * 86400 * 1000, maxRangeMs)
}

function formatUsDateForNasdaq(days: number) {
  const date = new Date()
  if (Number.isFinite(days)) {
    date.setDate(date.getDate() - Math.max(days + 14, 45))
  } else {
    date.setFullYear(date.getFullYear() - 10)
  }

  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function parseNasdaqHistoricalDate(value: string | undefined): string | null {
  if (!value) return null
  const [month, day, year] = value.split('/')
  if (!month || !day || !year) return null
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function parseCurrencyNumber(value: string | undefined): number {
  if (!value) return Number.NaN
  return Number(value.replace(/[$,]/g, '').trim())
}

function parseInteger(value: string | undefined): number {
  if (!value) return 0
  const parsed = Number(value.replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

export async function fetchKline(symbol: string, market: Market, options: { interval?: KlineInterval; range?: string } = {}): Promise<KlineFetchResult> {
  const interval = options.interval ?? '1d'
  const range = options.range ?? '6mo'
  const days = KLINE_RANGE_DAYS[range] ?? KLINE_RANGE_DAYS['6mo']
  const sourceChain = getSourceChain(market, interval)

  for (const source of sourceChain) {
    try {
      const data = await fetchBySource(source, symbol, market, interval, days)
      const filtered = filterByRange(data, days)
      if (filtered.length >= 2) {
        return { candles: filtered, source, interval, range }
      }
    } catch (error) {
      logger.warn('kline.fetch.sourceFailed', { error, source, symbol, market, interval, range })
      continue
    }
  }

  return { candles: [], interval, range, error: '暂无K线数据' }
}

export async function fetchDailyCandles(symbol: string, market: Market, limit = 240): Promise<KlineItem[]> {
  if (market === 'FUND') return []
  const range = limit <= 180 ? '6mo' : limit <= 366 ? '1y' : '3y'
  const result = await fetchKline(symbol, market, { interval: '1d', range })
  return result.candles.slice(-limit)
}
