import { NextResponse } from 'next/server'
import { generatePortfolioAnalysis } from '@/lib/ai/service'
import type { AiConfig, Stock } from '@/types'

type Body = {
  stocks?: Stock[]
  aiConfig?: AiConfig
  forceRefresh?: boolean
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body
    if (!Array.isArray(body.stocks)) {
      return NextResponse.json({ error: '缺少有效的持仓数据' }, { status: 400 })
    }
    if (!body.aiConfig) {
      return NextResponse.json({ error: '缺少 AI 配置' }, { status: 400 })
    }
    const result = await generatePortfolioAnalysis(body.stocks, body.aiConfig, body.forceRefresh === true)
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : '组合 AI 分析失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
