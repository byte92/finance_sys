import { NextResponse } from 'next/server'
import { testAiConnection } from '@/lib/ai/service'
import type { AiConfig } from '@/types'

type Body = {
  aiConfig?: AiConfig
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body
    if (!body.aiConfig) {
      return NextResponse.json({ error: '缺少 AI 配置' }, { status: 400 })
    }
    const result = await testAiConnection(body.aiConfig)
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : '模型连通测试失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
