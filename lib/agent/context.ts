import { estimateTokens, getContextStats } from '@/lib/ai/chat'
import type { AgentContextBuildResult, AgentPlan, AgentProviderMessage, AgentSkillResult } from '@/lib/agent/types'
import type { AiChatMessage, AiConfig } from '@/types'

function buildAgentSystemPrompt(language: AiConfig['analysisLanguage']) {
  return [
    '你是 StockTracker Agent，一名面向个人投资者的股票与持仓分析助手。',
    '你只能回答与用户当前持仓、用户明确提到的股票、交易记录、行情、估值、技术指标、风险、仓位和资产配置有关的问题。',
    '你必须优先基于 Agent 提供的 skillResults 回答，不得编造未提供的数据。',
    '如果 skillResults 中说明数据缺失，你需要明确指出缺失项，并给出下一步可观察的信号。',
    '你不能承诺收益，不能声称确定涨跌，不能提供内幕消息，不能把回答包装成绝对买卖指令。',
    '不要在每次回复中输出免责声明、风险提示模板或“仅供参考，不构成投资建议”之类的固定结尾；这些边界由界面中的固定提醒承担。',
    '回答要具体、直接、可执行，并区分事实、推断和行动条件。',
    `默认输出语言：${language === 'en-US' ? 'English' : '中文'}`,
  ].join('\n')
}

function compactHistory(messages: AiChatMessage[], maxHistoryTokens: number) {
  const compacted: AgentProviderMessage[] = []
  let used = 0
  for (const message of [...messages].reverse()) {
    if (message.role === 'system') continue
    const cost = message.tokenEstimate || estimateTokens(message.content)
    if (used + cost > Math.max(1024, maxHistoryTokens)) break
    compacted.unshift({ role: message.role, content: message.content })
    used += cost
  }
  return compacted
}

function compactSkillResult(result: AgentSkillResult) {
  return {
    skillName: result.skillName,
    ok: result.ok,
    data: result.data ?? null,
    error: result.error ?? null,
  }
}

export function composeAgentContext({
  aiConfig,
  history,
  userMessage,
  plan,
  skillResults,
}: {
  aiConfig: AiConfig
  history: AiChatMessage[]
  userMessage: string
  plan: AgentPlan
  skillResults: AgentSkillResult[]
}): AgentContextBuildResult {
  const contextSnapshot = {
    generatedAt: new Date().toISOString(),
    agent: {
      version: 1,
      intent: plan.intent,
      responseMode: plan.responseMode,
      entities: plan.entities,
      requiredSkills: plan.requiredSkills,
    },
    skillResults: skillResults.map(compactSkillResult),
  }
  const system = buildAgentSystemPrompt(aiConfig.analysisLanguage)
  const context = [
    '以下是 Agent 按需读取到的最小投资上下文。请只基于这些事实回答。',
    '如果某个 Skill 执行失败或返回空数据，请说明该数据不足，而不是猜测。',
    JSON.stringify(contextSnapshot),
  ].join('\n\n')
  const maxContextTokens = Math.max(4096, aiConfig.maxContextTokens || 128000)
  const reserved = estimateTokens(system) + estimateTokens(context) + estimateTokens(userMessage) + 1024
  const historyBudget = Math.max(0, maxContextTokens - reserved)
  const messages: AgentProviderMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: context },
    ...compactHistory(history, historyBudget),
    { role: 'user', content: userMessage },
  ]
  const tokenEstimate = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)

  return {
    messages,
    contextSnapshot,
    stats: getContextStats(tokenEstimate, maxContextTokens),
  }
}
