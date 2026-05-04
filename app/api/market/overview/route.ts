import { NextResponse } from 'next/server'
import { NEXT_API_ROUTES } from '@/lib/api/endpoints'
import { fetchMarketOverview } from '@/lib/marketOverview'
import { withApiLogging } from '@/lib/observability/api'
import { logger } from '@/lib/observability/logger'

async function handleGET() {
  try {
    const overview = await fetchMarketOverview()
    return NextResponse.json(overview)
  } catch (error) {
    logger.error('api.market.overview.failed', { error })
    return NextResponse.json({ error: '获取大盘数据失败' }, { status: 500 })
  }
}

export const GET = withApiLogging(NEXT_API_ROUTES.market.overview, handleGET)
