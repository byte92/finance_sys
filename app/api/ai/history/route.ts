import { type NextRequest, NextResponse } from 'next/server'
import { safeReadJsonBody } from '@/lib/api/request'
import { withApiLogging } from '@/lib/observability/api'
import { logger } from '@/lib/observability/logger'

const HISTORY_ERROR_MESSAGE = 'AI 分析历史服务暂时不可用，请稍后重试。'

function historyErrorResponse(error: unknown) {
  logger.error('api.ai.history.failed', { error })
  return NextResponse.json({ error: HISTORY_ERROR_MESSAGE }, { status: 500 })
}

async function handleGET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 })
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

    const { listAiAnalysisByUserId } = await import('@/lib/sqlite/db')
    const records = listAiAnalysisByUserId(userId, { type, confidence, dateFrom, dateTo, stockId, stockCode, market, limit })
    return NextResponse.json({ records })
  } catch (error) {
    return historyErrorResponse(error)
  }
}

type DeleteBody = {
  userId?: string
  id?: string
}

async function handleDELETE(request: NextRequest) {
  try {
    const payload = await safeReadJsonBody<DeleteBody>(request)
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }

    const body = payload.body
    if (!body.userId || !body.id) {
      return NextResponse.json({ error: '缺少 userId 或记录 ID' }, { status: 400 })
    }

    const { deleteAiAnalysisById } = await import('@/lib/sqlite/db')
    const deleted = deleteAiAnalysisById(body.userId, body.id)
    if (!deleted) {
      return NextResponse.json({ error: '未找到对应的分析记录' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return historyErrorResponse(error)
  }
}

export const GET = withApiLogging('/api/ai/history', handleGET)
export const DELETE = withApiLogging('/api/ai/history', handleDELETE)
