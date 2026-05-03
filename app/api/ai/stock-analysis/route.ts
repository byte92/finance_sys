import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { resolveEffectiveAiConfig } from '@/lib/ai/config'
import { buildAnalysisTags, generateStockAnalysis } from '@/lib/ai/service'
import { safeReadJsonBody } from '@/lib/api/request'
import { withApiLogging } from '@/lib/observability/api'
import { logger } from '@/lib/observability/logger'
import type { AiConfig, Stock } from '@/types'

type Body = {
  userId?: string
  stock?: Stock
  aiConfig?: AiConfig
  forceRefresh?: boolean
}

async function handlePOST(request: Request) {
  try {
    const payload = await safeReadJsonBody<Body>(request)
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }
    const body = payload.body
    if (!body.userId) {
      return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 })
    }
    if (!body.stock) {
      return NextResponse.json({ error: '缺少目标标的数据' }, { status: 400 })
    }
    if (!body.aiConfig) {
      return NextResponse.json({ error: '缺少 AI 配置' }, { status: 400 })
    }
    const result = await generateStockAnalysis(body.stock, resolveEffectiveAiConfig(body.aiConfig), body.forceRefresh === true)
    try {
      const { saveAiAnalysis } = await import('@/lib/sqlite/db')
      saveAiAnalysis({
        id: randomUUID(),
        userId: body.userId,
        type: 'stock',
        stockId: body.stock.id,
        stockCode: body.stock.code,
        stockName: body.stock.name,
        market: body.stock.market,
        confidence: result.confidence,
        tags: buildAnalysisTags('stock', result.confidence, result.analysisStrength, body.stock),
        generatedAt: result.generatedAt,
        result,
      })
    } catch (error) {
      logger.error('api.ai.stock-analysis.persist.failed', { error, userId: body.userId, stockId: body.stock.id })
    }
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : '标的 AI 分析失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const POST = withApiLogging('/api/ai/stock-analysis', handlePOST)
