import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { safeReadJsonBody } from '@/lib/api/request'
import { resolveEffectiveAiConfig } from '@/lib/ai/config'
import { buildChatContext, buildChatTitle, estimateTokens, streamChatCompletion, validateAiChatConfig, type ExternalStockRequest } from '@/lib/ai/chat'
import { getAiChatSession, listAiChatMessages, saveAiChatMessage, saveAiChatSession, updateAiChatSessionTitle } from '@/lib/sqlite/db'
import type { AiConfig, Stock } from '@/types'

type Body = {
  userId?: string
  sessionId?: string
  message?: string
  stocks?: Stock[]
  aiConfig?: AiConfig
  externalStocks?: ExternalStockRequest[]
}

export async function POST(request: Request) {
  const startedAt = Date.now()
  const payload = await safeReadJsonBody<Body>(request)
  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: payload.status })
  }

  const body = payload.body
  if (!body.userId) return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 })
  if (!body.aiConfig) return NextResponse.json({ error: '缺少 AI 配置' }, { status: 400 })
  if (!Array.isArray(body.stocks)) return NextResponse.json({ error: '缺少有效的持仓数据' }, { status: 400 })

  const userMessage = body.message?.trim()
  if (!userMessage) return NextResponse.json({ error: '请输入对话内容' }, { status: 400 })

  const effectiveAiConfig = resolveEffectiveAiConfig(body.aiConfig)

  try {
    validateAiChatConfig(effectiveAiConfig)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 配置无效'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const sessionId = body.sessionId || randomUUID()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantContent = ''
      let contextMs = 0
      let firstTokenMs: number | null = null
      try {
        const existingSession = getAiChatSession(body.userId!, sessionId)
        if (!existingSession) {
          saveAiChatSession({
            id: sessionId,
            userId: body.userId!,
            title: buildChatTitle(userMessage),
            scope: 'portfolio',
          })
        }

        const history = listAiChatMessages(body.userId!, sessionId)
        const needsExternalData = (body.externalStocks?.length ?? 0) > 0
        controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({
          phase: needsExternalData ? 'external-data' : 'local-context',
        })}\n\n`))

        const contextStartedAt = Date.now()
        const context = await buildChatContext({
          aiConfig: effectiveAiConfig,
          stocks: body.stocks!,
          history,
          userMessage,
          externalStocks: body.externalStocks ?? [],
        })
        contextMs = Date.now() - contextStartedAt

        saveAiChatMessage({
          id: randomUUID(),
          sessionId,
          userId: body.userId!,
          role: 'user',
          content: userMessage,
          contextSnapshot: context.contextSnapshot,
          tokenEstimate: estimateTokens(userMessage),
        })

        if (existingSession && existingSession.title === '新对话') {
          updateAiChatSessionTitle(body.userId!, sessionId, buildChatTitle(userMessage))
        }

        controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ sessionId, stats: context.stats, timings: { contextMs } })}\n\n`))
        controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ phase: 'generating' })}\n\n`))

        await streamChatCompletion(effectiveAiConfig, context.messages, (chunk) => {
          if (firstTokenMs === null) {
            firstTokenMs = Date.now() - startedAt
          }
          assistantContent += chunk
          controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: chunk })}\n\n`))
        })

        if (!assistantContent.trim()) {
          throw new Error('AI 未返回有效内容')
        }

        saveAiChatMessage({
          id: randomUUID(),
          sessionId,
          userId: body.userId!,
          role: 'assistant',
          content: assistantContent,
          contextSnapshot: context.contextSnapshot,
          tokenEstimate: estimateTokens(assistantContent),
        })

        const totalMs = Date.now() - startedAt
        console.info('[ai-chat] request timings', {
          sessionId,
          contextMs,
          firstTokenMs,
          totalMs,
          holdings: body.stocks?.length ?? 0,
          externalStocks: body.externalStocks?.length ?? 0,
          provider: effectiveAiConfig.provider,
          model: effectiveAiConfig.model,
        })
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ sessionId, timings: { contextMs, firstTokenMs, totalMs } })}\n\n`))
        controller.close()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI 对话失败'
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
