import { composeAgentContext } from '@/lib/agent/context'
import { executeAgentPlan } from '@/lib/agent/executor'
import { planAgentResponse } from '@/lib/agent/planner'
import type { AgentRunInput, AgentRunResult } from '@/lib/agent/types'

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const maxContextTokens = Math.max(4096, input.aiConfig.maxContextTokens || 128000)
  const plan = await planAgentResponse({
    userMessage: input.userMessage,
    stocks: input.stocks,
    externalStocks: input.externalStocks ?? [],
    aiConfig: input.aiConfig,
  })

  const skillResults = plan.responseMode === 'answer'
    ? await executeAgentPlan(plan, {
      userId: input.userId,
      sessionId: input.sessionId,
      stocks: input.stocks,
      aiConfig: input.aiConfig,
      maxContextTokens,
    })
    : []

  if (plan.responseMode === 'refuse') {
    const skillResults = [{
      skillName: 'agent.guardrail',
      ok: true,
      data: {
        message: '用户问题超出 StockTracker Agent 的投资数据分析范围，应礼貌拒绝并引导回持仓、交易、行情或风险管理。',
      },
    }]
    const context = composeAgentContext({
      aiConfig: input.aiConfig,
      history: input.history,
      userMessage: input.userMessage,
      plan,
      skillResults,
    })
    return { ...context, plan, skillResults }
  }

  if (plan.responseMode === 'clarify') {
    const skillResults = [{
      skillName: 'agent.clarify',
      ok: true,
      data: { question: plan.clarifyQuestion ?? '请补充更明确的标的信息。' },
    }]
    const context = composeAgentContext({
      aiConfig: input.aiConfig,
      history: input.history,
      userMessage: input.userMessage,
      plan,
      skillResults,
    })
    return { ...context, plan, skillResults }
  }

  const context = composeAgentContext({
    aiConfig: input.aiConfig,
    history: input.history,
    userMessage: input.userMessage,
    plan,
    skillResults,
  })

  return {
    ...context,
    plan,
    skillResults,
  }
}
