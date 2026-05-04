import { NextResponse } from 'next/server'
import { parseMarket } from '@/config/defaults'
import { NEXT_API_ROUTES } from '@/lib/api/endpoints'
import { fetchMarketHolidayCalendar } from '@/lib/external/holidayCalendar'
import { withApiLogging } from '@/lib/observability/api'
import { logger } from '@/lib/observability/logger'

const MIN_YEAR = 2007
const MAX_YEAR = 2100

function parseYear(value: string | null) {
  if (!value) return new Date().getFullYear()
  const year = Number(value)
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR ? year : null
}

async function handleGET(request: Request) {
  const { searchParams } = new URL(request.url)
  const market = parseMarket(searchParams.get('market'))
  const year = parseYear(searchParams.get('year'))

  if (!market) {
    return NextResponse.json({ error: 'Invalid query param: market' }, { status: 400 })
  }
  if (!year) {
    return NextResponse.json({ error: `Invalid query param: year. Use ${MIN_YEAR}-${MAX_YEAR}` }, { status: 400 })
  }

  try {
    const calendar = await fetchMarketHolidayCalendar(market, year)
    return NextResponse.json(
      { calendar },
      {
        headers: {
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      },
    )
  } catch (error) {
    logger.error('api.market.calendar.failed', { error, market, year })
    return NextResponse.json({ error: '获取市场日历失败' }, { status: 502 })
  }
}

export const GET = withApiLogging(NEXT_API_ROUTES.market.calendar, handleGET)
