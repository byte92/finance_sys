import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'
import type { MarketHolidayCalendar } from '@/lib/quoteDailyPnl'
import { thirdPartyApiUrls } from '@/lib/external/thirdPartyApis'
import type { Market } from '@/types'

type ChinaHolidayItem = {
  date?: unknown
  isOffDay?: unknown
}

const MARKET_CALENDAR_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MARKET_CALENDAR_SOURCE = 'api.jiejiariapi.com'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const calendarCache = new Map<string, { expiresAt: number; calendar: MarketHolidayCalendar }>()

function cacheKey(market: Market, year: number) {
  return `${market}:${year}`
}

function isChinaHolidayMarket(market: Market) {
  return market === 'A' || market === 'FUND'
}

function holidayApiHeaders() {
  const apiKey = process.env.JIEJIARI_API_KEY?.trim()
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
}

export function parseChinaHolidayApiResponse(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid China holiday calendar response')
  }

  const holidays = new Set<string>()
  for (const [date, item] of Object.entries(payload as Record<string, ChinaHolidayItem | null>)) {
    if (!item || item.isOffDay !== true) continue
    const holidayDate = typeof item.date === 'string' ? item.date : date
    if (DATE_PATTERN.test(holidayDate)) holidays.add(holidayDate)
  }

  return Array.from(holidays).sort()
}

export async function fetchMarketHolidayCalendar(market: Market, year: number): Promise<MarketHolidayCalendar> {
  const cached = calendarCache.get(cacheKey(market, year))
  if (cached && cached.expiresAt > Date.now()) {
    return cached.calendar
  }

  if (!isChinaHolidayMarket(market)) {
    return {
      market,
      year,
      holidays: [],
      source: 'none',
      fetchedAt: new Date().toISOString(),
    }
  }

  const headers = holidayApiHeaders()
  const url = thirdPartyApiUrls.chinaHolidayYear(year)
  const response = await loggedFetch(url, {
    signal: AbortSignal.timeout(5000),
    cache: 'no-store',
    headers,
  }, {
    operation: 'marketCalendar.chinaHoliday.year',
    provider: MARKET_CALENDAR_SOURCE,
    resource: String(year),
    metadata: { market, authenticated: !!headers },
  })

  if (!response.ok) {
    throw new Error(`China holiday calendar request failed: ${response.status}`)
  }

  const holidays = parseChinaHolidayApiResponse(await response.json())
  if (holidays.length === 0) {
    throw new Error(`China holiday calendar ${year} returned no holidays`)
  }

  const calendar: MarketHolidayCalendar = {
    market,
    year,
    holidays,
    source: MARKET_CALENDAR_SOURCE,
    fetchedAt: new Date().toISOString(),
  }

  calendarCache.set(cacheKey(market, year), {
    expiresAt: Date.now() + MARKET_CALENDAR_CACHE_TTL_MS,
    calendar,
  })
  logger.debug('marketCalendar.cache.write', {
    market,
    year,
    source: MARKET_CALENDAR_SOURCE,
    holidayCount: holidays.length,
  })

  return calendar
}
