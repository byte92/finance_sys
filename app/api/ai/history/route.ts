import { NextRequest, NextResponse } from 'next/server'
import { listAiAnalysisByUserId } from '@/lib/sqlite/db'

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  const type = request.nextUrl.searchParams.get('type') || undefined
  const confidence = request.nextUrl.searchParams.get('confidence') || undefined
  const dateFrom = request.nextUrl.searchParams.get('dateFrom') || undefined
  const dateTo = request.nextUrl.searchParams.get('dateTo') || undefined

  const records = listAiAnalysisByUserId(userId, { type, confidence, dateFrom, dateTo })
  return NextResponse.json({ records })
}
