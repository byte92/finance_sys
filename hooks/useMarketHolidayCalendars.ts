'use client'

import { useEffect, useMemo, useState } from 'react'
import { nextApiUrls } from '@/lib/api/endpoints'
import {
  getMarketDate,
  needsMarketHolidayCalendar,
  type MarketHolidayCalendar,
} from '@/lib/quoteDailyPnl'
import type { Market } from '@/types'

type MarketHolidayCalendarState = Partial<Record<Market, MarketHolidayCalendar>>

const STORAGE_PREFIX = 'stock-tracker-market-calendar-v1'

function storageKey(market: Market, year: number) {
  return `${STORAGE_PREFIX}:${market}:${year}`
}

function currentMarketYear(market: Market) {
  return Number(getMarketDate(new Date(), market).slice(0, 4))
}

function isValidCalendar(value: unknown, market: Market, year: number): value is MarketHolidayCalendar {
  const calendar = value as MarketHolidayCalendar | null
  return (
    !!calendar &&
    calendar.market === market &&
    calendar.year === year &&
    Array.isArray(calendar.holidays) &&
    typeof calendar.source === 'string' &&
    typeof calendar.fetchedAt === 'string'
  )
}

function readCachedCalendar(market: Market, year: number) {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(storageKey(market, year))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return isValidCalendar(parsed, market, year) ? parsed : null
  } catch {
    return null
  }
}

function writeCachedCalendar(calendar: MarketHolidayCalendar) {
  try {
    window.localStorage.setItem(storageKey(calendar.market, calendar.year), JSON.stringify(calendar))
  } catch {
    // localStorage may be unavailable in private mode; the server cache still protects the API.
  }
}

export function useMarketHolidayCalendars(markets: Market[]) {
  const requiredCalendars = useMemo(
    () => Array.from(new Set(markets))
      .filter(needsMarketHolidayCalendar)
      .map((market) => ({ market, year: currentMarketYear(market) })),
    [markets],
  )
  const [calendars, setCalendars] = useState<MarketHolidayCalendarState>({})
  const [loading, setLoading] = useState(requiredCalendars.length > 0)

  useEffect(() => {
    let cancelled = false

    async function loadCalendars() {
      if (requiredCalendars.length === 0) {
        setCalendars({})
        setLoading(false)
        return
      }

      const cachedEntries = requiredCalendars
        .map(({ market, year }): readonly [Market, MarketHolidayCalendar | null] => [market, readCachedCalendar(market, year)])
        .filter((entry): entry is readonly [Market, MarketHolidayCalendar] => entry[1] !== null)

      if (cachedEntries.length > 0) {
        setCalendars((current) => ({ ...current, ...Object.fromEntries(cachedEntries) }))
      }

      setLoading(cachedEntries.length < requiredCalendars.length)

      const pending = requiredCalendars.filter(
        ({ market, year }) => !cachedEntries.some(([cachedMarket, calendar]) => cachedMarket === market && calendar.year === year),
      )
      if (pending.length === 0) return

      try {
        const responses = await Promise.all(
          pending.map(async ({ market, year }) => {
            const res = await fetch(nextApiUrls.market.calendar(market, year), {
              cache: 'no-store',
            })
            if (!res.ok) throw new Error(`Market calendar request failed: ${res.status}`)
            const data = await res.json()
            const calendar = data?.calendar as unknown
            if (!isValidCalendar(calendar, market, year)) throw new Error('Invalid market calendar payload')
            writeCachedCalendar(calendar)
            return [market, calendar] as const
          }),
        )

        if (!cancelled) {
          setCalendars((current) => ({ ...current, ...Object.fromEntries(responses) }))
        }
      } catch (error) {
        console.error('Failed to load market holiday calendars:', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadCalendars()

    return () => {
      cancelled = true
    }
  }, [requiredCalendars])

  return { calendars, loading }
}
