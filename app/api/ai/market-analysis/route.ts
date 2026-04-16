import { NextRequest, NextResponse } from 'next/server'
import { generateId } from '@/lib/finance'
import { generateMarketAnalysis, buildAnalysisTags } from '@/lib/marketOverview'
import { saveAiAnalysis } from '@/lib/sqlite/db'
import type { AiConfig } from '@/types'

type MarketAnalysisBody = {
  userId?: string
  aiConfig?: AiConfig
  forceRefresh?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MarketAnalysisBody
    if (!body.userId) {
      return NextResponse.json({ error: '缺少 userId' }, { status: 400 })
    }
    if (!body.aiConfig) {
      return NextResponse.json({ error: '缺少 aiConfig' }, { status: 400 })
    }

    const result = await generateMarketAnalysis(body.aiConfig, body.forceRefresh)

    saveAiAnalysis({
      id: generateId(),
      userId: body.userId,
      type: 'market',
      confidence: result.confidence,
      tags: buildAnalysisTags('market', result.confidence),
      result,
      generatedAt: result.generatedAt,
      stockId: null,
      stockCode: null,
      stockName: null,
      market: null,
    })

    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : '大盘 AI 分析失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
