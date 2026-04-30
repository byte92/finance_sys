import { NextRequest, NextResponse } from 'next/server'
import { deleteAiAnalysisById, listAiAnalysisByUserId } from '@/lib/sqlite/db'

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('userId')
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
  }

  const type = request.nextUrl.searchParams.get('type') || undefined
  const confidence = request.nextUrl.searchParams.get('confidence') || undefined
  const dateFrom = request.nextUrl.searchParams.get('dateFrom') || undefined
  const dateTo = request.nextUrl.searchParams.get('dateTo') || undefined
  const stockId = request.nextUrl.searchParams.get('stockId') || undefined
  const stockCode = request.nextUrl.searchParams.get('stockCode') || undefined
  const market = request.nextUrl.searchParams.get('market') || undefined
  const limitParam = request.nextUrl.searchParams.get('limit')
  const limit = limitParam ? Number(limitParam) : undefined

  const records = listAiAnalysisByUserId(userId, { type, confidence, dateFrom, dateTo, stockId, stockCode, market, limit })
  return NextResponse.json({ records })
}

type DeleteBody = {
  userId?: string
  id?: string
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as DeleteBody
    if (!body.userId || !body.id) {
      return NextResponse.json({ error: '缺少 userId 或记录 ID' }, { status: 400 })
    }

    const deleted = deleteAiAnalysisById(body.userId, body.id)
    if (!deleted) {
      return NextResponse.json({ error: '未找到对应的分析记录' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除分析记录失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
