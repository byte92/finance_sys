import { type NextRequest, NextResponse } from 'next/server'
import { resolveEffectiveAiConfig } from '@/lib/ai/config'
import { generateId } from '@/lib/finance'
import { generateMarketAnalysis, buildAnalysisTags } from '@/lib/marketOverview'
import { safeReadJsonBody } from '@/lib/api/request'
import type { AiConfig } from '@/types'

type MarketAnalysisBody = {
  userId?: string
  aiConfig?: AiConfig
  forceRefresh?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const payload = await safeReadJsonBody<MarketAnalysisBody>(request)
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }
    const body = payload.body
    if (!body.userId) {
      return NextResponse.json({ error: '缺少 userId' }, { status: 400 })
    }
    if (!body.aiConfig) {
      return NextResponse.json({ error: '缺少 aiConfig' }, { status: 400 })
    }

    const result = await generateMarketAnalysis(resolveEffectiveAiConfig(body.aiConfig), body.forceRefresh)

    try {
      const { saveAiAnalysis } = await import('@/lib/sqlite/db')
      saveAiAnalysis({
        id: generateId(),
        userId: body.userId,
        type: 'market',
        confidence: result.confidence,
        tags: buildAnalysisTags('market', result.confidence, result.analysisStrength),
        result,
        generatedAt: result.generatedAt,
        stockId: null,
        stockCode: null,
        stockName: null,
        market: null,
      })
    } catch (error) {
      console.error('Failed to persist market AI analysis:', error)
    }

    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : '大盘 AI 分析失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
