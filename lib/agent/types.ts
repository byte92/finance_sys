import type { AiChatContextStats, AiChatMessage, AiConfig, Market, Stock } from '@/types'

export type AgentIntent =
  | 'stock_analysis'
  | 'portfolio_risk'
  | 'portfolio_summary'
  | 'trade_review'
  | 'market_question'
  | 'out_of_scope'
  | 'unknown'

export type AgentResponseMode = 'answer' | 'clarify' | 'refuse'

export type AgentDataScope =
  | 'portfolio.read'
  | 'stock.read'
  | 'trade.read'
  | 'quote.read'
  | 'chat.read'
  | 'market.read'
  | 'network.fetch'

export type AgentEntity = {
  type: 'stock' | 'market' | 'portfolio'
  raw: string
  code?: string
  name?: string
  market?: Market
  stockId?: string
  confidence: number
}

export type AgentSkillCall = {
  name: string
  args: Record<string, unknown>
  reason: string
}

export type AgentPlan = {
  intent: AgentIntent
  entities: AgentEntity[]
  requiredSkills: AgentSkillCall[]
  responseMode: AgentResponseMode
  clarifyQuestion?: string
}

export type AgentExecutionContext = {
  userId: string
  sessionId: string
  stocks: Stock[]
  aiConfig: AiConfig
  maxContextTokens: number
}

export type AgentSkillResult<TResult = unknown> = {
  skillName: string
  ok: boolean
  data?: TResult
  error?: string
  tokenEstimate?: number
  /** V2: 是否需要追加 Skill 调用 */
  needsFollowUp?: boolean
  /** V2: 建议的后续 Skill（当 needsFollowUp 为 true 时） */
  suggestedSkills?: AgentSkillCall[]
}

export type AgentSkill<TArgs = Record<string, unknown>, TResult = unknown> = {
  name: string
  description: string
  version?: number
  inputSchema: Record<string, unknown>
  requiredScopes: AgentDataScope[]
  dependencies?: string[]
  script?: string
  prompt?: string
  documentation?: string
  sourcePath?: string
  execute: (args: TArgs, ctx: AgentExecutionContext) => Promise<AgentSkillResult<TResult>>
}

export type AgentAnswerType =
  | 'stock_holding_review'
  | 'trade_review'
  | 'portfolio_review'
  | 'market_review'
  | 'clarify'
  | 'refusal'
  | 'general'

export type AgentAnswerItem = {
  label: string
  value: unknown
  source: string
  note?: string
}

export type AgentAnswerDraft = {
  answerType: AgentAnswerType
  facts: AgentAnswerItem[]
  calculations: AgentAnswerItem[]
  inferences: AgentAnswerItem[]
  missingData: AgentAnswerItem[]
  recommendations: AgentAnswerItem[]
  qualityWarnings: AgentAnswerItem[]
  confidence: 'low' | 'medium' | 'high'
}

export type AgentProviderMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type AgentContextBuildResult = {
  messages: AgentProviderMessage[]
  contextSnapshot: Record<string, unknown>
  answerDraft: AgentAnswerDraft
  stats: AiChatContextStats
}

export type AgentRunResult = AgentContextBuildResult & {
  plan: AgentPlan
  skillResults: AgentSkillResult[]
}

export type AgentRunInput = {
  userId: string
  sessionId: string
  aiConfig: AiConfig
  stocks: Stock[]
  history: AiChatMessage[]
  userMessage: string
  externalStocks?: Array<{ symbol: string; market: Market }>
}
