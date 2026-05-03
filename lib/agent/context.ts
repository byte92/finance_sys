import { estimateTokens, getContextStats } from '@/lib/ai/chat'
import { buildAgentAnswerDraft } from '@/lib/agent/answer/builder'
import type { AgentAnswerDraft, AgentContextBuildResult, AgentPlan, AgentProviderMessage, AgentSkillResult } from '@/lib/agent/types'
import type { AiChatMessage, AiConfig } from '@/types'

function buildAgentSystemPrompt(language: AiConfig['analysisLanguage']) {
  return [
    '你是 StockTracker Agent，一名面向个人投资者的投资标的与持仓分析助手。',
    '你只能回答与用户当前持仓、用户明确提到的标的、交易记录、行情、估值、技术指标、风险、仓位和资产配置有关的问题。',
    '你必须优先基于 Agent 提供的 skillResults 回答，不得编造未提供的数据。',
    '如果 skillResults 中说明数据缺失，你需要明确指出缺失项，并给出下一步可观察的信号。',
    '你会收到 answerDraft，它是系统从 skillResults 中抽取出的回答骨架。必须优先使用 answerDraft 中的事实、计算、缺失数据和质量警告组织回复。',
    '如果使用 web.search 结果，必须把它们作为公开网页候选来源呈现，包含搜索时间、标题、链接、摘要/要点；不要把搜索结果说成实时数据库事实或已完全核验的事实。',
    '涉及收益、交易、成本、分红/派息、手续费等数字时，必须说明口径；不要把累计收益说成单笔收益，不要把当前行情或技术指标倒推成历史交易当日依据。',
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

function compactAnswerDraft(draft: AgentAnswerDraft) {
  return draft
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
  const answerDraft = buildAgentAnswerDraft(plan, skillResults)
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
    answerDraft: compactAnswerDraft(answerDraft),
  }
  const system = buildAgentSystemPrompt(aiConfig.analysisLanguage)
  const context = [
    '以下是 Agent 按需读取到的最小投资上下文。请只基于这些事实回答。',
    '如果某个 Skill 执行失败或返回空数据，请说明该数据不足，而不是猜测。',
    'answerDraft 是优先回答依据；skillResults 是原始证据。若两者冲突，以 skillResults 为准并说明不确定性。',
    'web.search 的 searchedAt 是检索执行时间；results 是公开网页候选来源。回答新闻/公告/政策类问题时请引用标题、链接和摘要/要点。',
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
    answerDraft,
    stats: getContextStats(tokenEstimate, maxContextTokens),
  }
}
