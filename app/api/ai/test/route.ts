import { NextResponse } from 'next/server'
import { resolveEffectiveAiConfig } from '@/lib/ai/config'
import { testAiConnection } from '@/lib/ai/service'
import { safeReadJsonBody } from '@/lib/api/request'
import type { AiConfig } from '@/types'

type Body = {
  aiConfig?: AiConfig
}

export async function POST(request: Request) {
  try {
    const payload = await safeReadJsonBody<Body>(request)
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }
    const body = payload.body
    if (!body.aiConfig) {
      return NextResponse.json({ error: '缺少 AI 配置' }, { status: 400 })
    }
    const result = await testAiConnection(resolveEffectiveAiConfig(body.aiConfig))
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : '模型连通测试失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
