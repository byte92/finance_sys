import { NextResponse } from 'next/server'
import { fetchMarketOverview } from '@/lib/marketOverview'

export async function GET() {
  try {
    const overview = await fetchMarketOverview()
    return NextResponse.json(overview)
  } catch (error) {
    console.error('[api/market/overview] failed:', error)
    return NextResponse.json({ error: '获取大盘数据失败' }, { status: 500 })
  }
}
