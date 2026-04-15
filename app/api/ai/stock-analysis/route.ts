import { NextResponse } from 'next/server'
import { generateStockAnalysis } from '@/lib/ai/service'
import type { AiConfig, Stock } from '@/types'

type Body = {
  stock?: Stock
  aiConfig?: AiConfig
  forceRefresh?: boolean
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body
    if (!body.stock) {
      return NextResponse.json({ error: '缺少目标股票数据' }, { status: 400 })
    }
    if (!body.aiConfig) {
      return NextResponse.json({ error: '缺少 AI 配置' }, { status: 400 })
    }
    const result = await generateStockAnalysis(body.stock, body.aiConfig, body.forceRefresh === true)
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : '个股 AI 分析失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
