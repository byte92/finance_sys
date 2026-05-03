import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { safeReadJsonBody } from '@/lib/api/request'
import { resolveEffectiveAiConfig } from '@/lib/ai/config'
import { buildChatTitle, estimateTokens, streamChatCompletion, validateAiChatConfig } from '@/lib/ai/chat'
import { runAgent } from '@/lib/agent/runtime'
import { withApiLogging } from '@/lib/observability/api'
import { logger } from '@/lib/observability/logger'
import { getAiChatSession, getSessionContext, listAiChatMessages, saveAiAgentRun, saveAiChatMessage, saveAiChatSession, setSessionContext, updateAiChatSessionTitle } from '@/lib/sqlite/db'
import type { AiConfig, Market, Stock } from '@/types'

type Body = {
  userId?: string
  sessionId?: string
  message?: string
  stocks?: Stock[]
  aiConfig?: AiConfig
  externalStocks?: Array<{ symbol: string; market: Market }>
}

const MARKET_ALIASES: Record<Market, string[]> = {
  A: ['A', 'A股', 'A 股', '沪深', '上证', '深交所', '上交所'],
  HK: ['HK', '港股', '香港', '港交所'],
  US: ['US', '美股', '美国', '纳斯达克', '纽交所', 'NYSE', 'NASDAQ'],
  FUND: ['FUND', '基金', 'ETF'],
  CRYPTO: ['CRYPTO', '加密', '币', '数字货币', '虚拟货币', 'USDT', 'USDC'],
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function matchesCandidateAnswer(answer: string, candidate: { code: string; name: string; market: string }) {
  const upperAnswer = answer.toUpperCase()
  const market = candidate.market as Market
  return upperAnswer.includes(candidate.code.toUpperCase())
    || answer.includes(candidate.name)
    || upperAnswer.includes(candidate.market.toUpperCase())
    || (MARKET_ALIASES[market] ?? []).some((alias) => upperAnswer.includes(alias.toUpperCase()))
}

async function handlePOST(request: Request) {
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
      let agentRunId: string | null = null
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

        // 检查是否有待澄清的状态（多轮）
        const pending = existingSession ? getSessionContext(body.userId!, sessionId) : null
        let externalStocks = body.externalStocks ?? []
        if (pending?.type === 'clarify' && Array.isArray(pending.candidates) && pending.candidates.length > 0) {
          // 用户正在选择一个候选标的
          const userAnswer = userMessage.trim()
          const candidates = pending.candidates as Array<{ code: string; name: string; market: string }>
          const match = candidates.find((c) => matchesCandidateAnswer(userAnswer, c))

          if (match && match.market) {
            externalStocks = [{ symbol: match.code, market: match.market as Market }]
            setSessionContext(body.userId!, sessionId, null) // 匹配后消费澄清状态
          }
        }

        const history = listAiChatMessages(body.userId!, sessionId)
        controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ phase: 'planning' })}\n\n`))

        const contextStartedAt = Date.now()
        const agent = await runAgent({
          userId: body.userId!,
          sessionId,
          aiConfig: effectiveAiConfig,
          stocks: body.stocks!,
          history,
          userMessage,
          externalStocks,
        })
        contextMs = Date.now() - contextStartedAt
        agentRunId = randomUUID()

        const userMessageId = randomUUID()
        saveAiChatMessage({
          id: userMessageId,
          sessionId,
          userId: body.userId!,
          role: 'user',
          content: userMessage,
          contextSnapshot: agent.contextSnapshot,
          tokenEstimate: estimateTokens(userMessage),
        })
        saveAiAgentRun({
          id: agentRunId,
          sessionId,
          userId: body.userId!,
          messageId: userMessageId,
          intent: agent.plan.intent,
          responseMode: agent.plan.responseMode,
          plan: agent.plan as unknown as Record<string, unknown>,
          skillCalls: agent.plan.requiredSkills,
          skillResults: agent.skillResults,
          contextStats: agent.stats as unknown as Record<string, unknown>,
        })

        // 如果是澄清模式，保存候选列表供下一轮消费
        if (agent.plan.responseMode === 'clarify') {
          const candidatesResult = agent.skillResults.find((r) => r.skillName === 'security.resolve')
            ?? agent.skillResults.find((r) => r.skillName === 'market.resolveCandidate')
          if (candidatesResult?.ok && candidatesResult.data) {
            const data = candidatesResult.data as { candidates?: Array<{ code: string; name: string; market: string }> }
            if (data.candidates?.length) {
              setSessionContext(body.userId!, sessionId, {
                type: 'clarify',
                candidates: data.candidates,
              })
            }
          }
        }

        if (existingSession && existingSession.title === '新对话') {
          updateAiChatSessionTitle(body.userId!, sessionId, buildChatTitle(userMessage))
        }

        controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({
          sessionId,
          stats: agent.stats,
          timings: { contextMs },
          agent: {
            runId: agentRunId,
            intent: agent.plan.intent,
            responseMode: agent.plan.responseMode,
            skillCount: agent.skillResults.length,
          },
        })}\n\n`))
        controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ phase: 'generating' })}\n\n`))

        await streamChatCompletion(effectiveAiConfig, agent.messages, (chunk) => {
          if (firstTokenMs === null) {
            firstTokenMs = Date.now() - startedAt
          }
          assistantContent += chunk
          controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: chunk })}\n\n`))
        }, request.signal)

        if (!assistantContent.trim()) {
          throw new Error('AI 未返回有效内容')
        }

        saveAiChatMessage({
          id: randomUUID(),
          sessionId,
          userId: body.userId!,
          role: 'assistant',
          content: assistantContent,
          contextSnapshot: agent.contextSnapshot,
          tokenEstimate: estimateTokens(assistantContent),
        })

        const totalMs = Date.now() - startedAt
        logger.info('api.ai.chat.stream.done', {
          sessionId,
          contextMs,
          firstTokenMs,
          totalMs,
          holdings: body.stocks?.length ?? 0,
          externalStocks: body.externalStocks?.length ?? 0,
          intent: agent.plan.intent,
          skillCount: agent.skillResults.length,
          provider: effectiveAiConfig.provider,
          model: effectiveAiConfig.model,
        })
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ sessionId, runId: agentRunId, timings: { contextMs, firstTokenMs, totalMs } })}\n\n`))
        controller.close()
      } catch (error) {
        if (request.signal.aborted || isAbortError(error)) {
          logger.info('api.ai.chat.stream.aborted', {
            sessionId,
            contextMs,
            firstTokenMs,
            totalMs: Date.now() - startedAt,
            assistantChars: assistantContent.length,
          })
          if (assistantContent.trim()) {
            saveAiChatMessage({
              id: randomUUID(),
              sessionId,
              userId: body.userId!,
              role: 'assistant',
              content: assistantContent,
              contextSnapshot: null,
              tokenEstimate: estimateTokens(assistantContent),
            })
          }
          try {
            controller.close()
          } catch {
            // 客户端主动断开时 stream 可能已经关闭。
          }
          return
        }
        logger.error('api.ai.chat.stream.failed', {
          error,
          sessionId,
          contextMs,
          firstTokenMs,
          totalMs: Date.now() - startedAt,
          assistantChars: assistantContent.length,
        })
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

export const POST = withApiLogging('/api/ai/chat', handlePOST)
