import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { buildAnalysisTags, generatePortfolioAnalysis } from '@/lib/ai/service'
import { saveAiAnalysis } from '@/lib/sqlite/db'
import type { AiConfig, Stock } from '@/types'

type Body = {
  userId?: string
  stocks?: Stock[]
  aiConfig?: AiConfig
  forceRefresh?: boolean
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body
    if (!body.userId) {
      return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 })
    }
    if (!Array.isArray(body.stocks)) {
      return NextResponse.json({ error: '缺少有效的持仓数据' }, { status: 400 })
    }
    if (!body.aiConfig) {
      return NextResponse.json({ error: '缺少 AI 配置' }, { status: 400 })
    }
    const result = await generatePortfolioAnalysis(body.stocks, body.aiConfig, body.forceRefresh === true)
    saveAiAnalysis({
      id: randomUUID(),
      userId: body.userId,
      type: 'portfolio',
      stockId: null,
      stockCode: null,
      stockName: null,
      market: null,
      confidence: result.confidence,
      tags: buildAnalysisTags('portfolio', result.confidence, result.analysisStrength),
      generatedAt: result.generatedAt,
      result,
    })
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : '组合 AI 分析失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
