import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { NEXT_API_ROUTES } from '@/lib/api/endpoints'
import { safeReadJsonBody } from '@/lib/api/request'
import { resolveEffectiveAiConfig } from '@/lib/ai/config'
import { buildChatTitle, estimateTokens, getContextStats, streamChatCompletion, validateAiChatConfig } from '@/lib/ai/chat'
import { runAgent } from '@/lib/agent/runtime'
import {
  buildClarificationQuestion,
  normalizeClarificationCandidates,
  normalizeClarificationState,
  resolveClarificationSelection,
} from '@/lib/agent/clarification'
import { withApiLogging } from '@/lib/observability/api'
import { logger } from '@/lib/observability/logger'
import { getAiChatSession, getSessionContext, listAiChatMessages, saveAiAgentRun, saveAiChatMessage, saveAiChatSession, setSessionContext, updateAiChatSessionTitle } from '@/lib/sqlite/db'
import type { AgentPlan, AgentResolvedSecurity } from '@/lib/agent/types'
import type { AiConfig, Market, Stock } from '@/types'

type Body = {
  userId?: string
  sessionId?: string
  message?: string
  stocks?: Stock[]
  aiConfig?: AiConfig
  externalStocks?: Array<{ symbol: string; market: Market }>
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
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

        controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ phase: 'planning' })}\n\n`))

        // 检查是否有待澄清的状态（多轮）。候选选择由 LLM 在对话内判断；
        // 识别不到时继续追问，不通过 UI 弹窗阻断对话。
        const pending = existingSession ? normalizeClarificationState(getSessionContext(body.userId!, sessionId)) : null
        let externalStocks = body.externalStocks ?? []
        let resolvedSecurities: AgentResolvedSecurity[] = []
        let agentUserMessage = userMessage
        if (pending) {
          const resolution = await resolveClarificationSelection({
            userMessage,
            pending,
            aiConfig: effectiveAiConfig,
          })

          if (resolution.status === 'selected') {
            const candidate = resolution.candidate
            resolvedSecurities = [{
              symbol: candidate.code,
              market: candidate.market,
              name: candidate.name,
              stockId: candidate.stockId,
              inPortfolio: candidate.inPortfolio,
            }]
            if (pending.originalUserMessage) {
              agentUserMessage = `${pending.originalUserMessage}\n用户澄清选择：${userMessage}`
            }
            setSessionContext(body.userId!, sessionId, null)
          } else if (resolution.status === 'new_question') {
            setSessionContext(body.userId!, sessionId, null)
          } else {
            const candidates = normalizeClarificationCandidates(pending.candidates)
            const question = resolution.question || buildClarificationQuestion(candidates, pending.question)
            setSessionContext(body.userId!, sessionId, { ...pending, question })

            agentRunId = randomUUID()
            const userMessageId = randomUUID()
            const plan: AgentPlan = {
              intent: 'stock_analysis',
              entities: candidates.map((candidate) => ({
                type: 'stock',
                raw: candidate.name || candidate.code,
                code: candidate.code,
                name: candidate.name,
                market: candidate.market,
                stockId: candidate.stockId,
                confidence: candidate.confidence ?? 0.5,
              })),
              requiredSkills: [],
              responseMode: 'clarify',
              clarifyQuestion: question,
            }
            const skillResults = [{
              skillName: 'agent.clarify',
              ok: true,
              data: { question, candidates, reason: resolution.reason ?? null },
            }]
            const contextSnapshot = {
              generatedAt: new Date().toISOString(),
              agent: {
                version: 2,
                intent: plan.intent,
                responseMode: plan.responseMode,
                entities: plan.entities,
                requiredSkills: plan.requiredSkills,
              },
              skillResults,
            }
            const stats = getContextStats(
              estimateTokens(JSON.stringify(contextSnapshot)) + estimateTokens(userMessage) + estimateTokens(question),
              effectiveAiConfig.maxContextTokens || 128000,
            )

            saveAiChatMessage({
              id: userMessageId,
              sessionId,
              userId: body.userId!,
              role: 'user',
              content: userMessage,
              contextSnapshot,
              tokenEstimate: estimateTokens(userMessage),
            })
            saveAiAgentRun({
              id: agentRunId,
              sessionId,
              userId: body.userId!,
              messageId: userMessageId,
              intent: plan.intent,
              responseMode: plan.responseMode,
              plan: plan as unknown as Record<string, unknown>,
              skillCalls: plan.requiredSkills,
              skillResults,
              contextStats: stats as unknown as Record<string, unknown>,
            })
            saveAiChatMessage({
              id: randomUUID(),
              sessionId,
              userId: body.userId!,
              role: 'assistant',
              content: question,
              contextSnapshot,
              tokenEstimate: estimateTokens(question),
            })

            if (existingSession && existingSession.title === '新对话') {
              updateAiChatSessionTitle(body.userId!, sessionId, buildChatTitle(userMessage))
            }

            firstTokenMs = Date.now() - startedAt
            assistantContent = question
            controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({
              sessionId,
              stats,
              timings: { contextMs },
              agent: {
                runId: agentRunId,
                intent: plan.intent,
                responseMode: plan.responseMode,
                skillCount: skillResults.length,
              },
            })}\n\n`))
            controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ phase: 'generating' })}\n\n`))
            controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: question })}\n\n`))
            controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({
              sessionId,
              runId: agentRunId,
              timings: { contextMs, firstTokenMs, totalMs: Date.now() - startedAt },
            })}\n\n`))
            controller.close()
            return
          }
        }

        const history = listAiChatMessages(body.userId!, sessionId)

        const contextStartedAt = Date.now()
        const agent = await runAgent({
          userId: body.userId!,
          sessionId,
          aiConfig: effectiveAiConfig,
          stocks: body.stocks!,
          history,
          userMessage: agentUserMessage,
          resolvedSecurities,
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
            const data = candidatesResult.data as { candidates?: unknown }
            const candidates = normalizeClarificationCandidates(data.candidates)
            if (candidates.length) {
              const question = agent.plan.clarifyQuestion || buildClarificationQuestion(candidates)
              setSessionContext(body.userId!, sessionId, {
                type: 'clarify',
                candidates,
                question,
                originalUserMessage: userMessage,
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

export const POST = withApiLogging(NEXT_API_ROUTES.ai.chat, handlePOST)
