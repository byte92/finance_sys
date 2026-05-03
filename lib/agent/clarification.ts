import { MARKET_LABELS } from '@/config/defaults'
import { callJsonCompletion } from '@/lib/external/llmProvider'
import type { AgentResolvedSecurity } from '@/lib/agent/types'
import type { AiConfig, Market } from '@/types'

export type AgentClarificationCandidate = AgentResolvedSecurity & {
  code: string
  confidence?: number
  source?: string
}

export type AgentClarificationState = {
  type: 'clarify'
  candidates: AgentClarificationCandidate[]
  question?: string
  originalUserMessage?: string
}

export type AgentClarificationResolution =
  | { status: 'selected'; candidate: AgentClarificationCandidate; confidence: number; reason?: string }
  | { status: 'ask'; question: string; reason?: string }
  | { status: 'new_question'; reason?: string }

const CLARIFICATION_TIMEOUT_MS = 6_000
const SELECT_CONFIDENCE_THRESHOLD = 0.7

function isMarket(value: unknown): value is Market {
  return value === 'A' || value === 'HK' || value === 'US' || value === 'FUND' || value === 'CRYPTO'
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function toCandidate(value: unknown): AgentClarificationCandidate | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const code = text(item.code ?? item.symbol)
  const market = item.market
  if (!code || !isMarket(market)) return null
  const stockId = text(item.stockId)
  const inPortfolio = normalizeBoolean(item.inPortfolio) ?? Boolean(stockId)
  return {
    symbol: code,
    code,
    market,
    name: text(item.name) || code,
    stockId: stockId || undefined,
    inPortfolio,
    confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
    source: text(item.source) || undefined,
  }
}

export function normalizeClarificationCandidates(value: unknown) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const candidates: AgentClarificationCandidate[] = []
  for (const item of value) {
    const candidate = toCandidate(item)
    if (!candidate) continue
    const key = `${candidate.market}:${candidate.code.toUpperCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(candidate)
  }
  return candidates
}

export function normalizeClarificationState(value: unknown): AgentClarificationState | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Record<string, unknown>
  if (state.type !== 'clarify') return null
  const candidates = normalizeClarificationCandidates(state.candidates)
  if (!candidates.length) return null
  return {
    type: 'clarify',
    candidates,
    question: text(state.question) || undefined,
    originalUserMessage: text(state.originalUserMessage) || undefined,
  }
}

function candidateLabel(candidate: AgentClarificationCandidate) {
  const market = MARKET_LABELS[candidate.market] ?? candidate.market
  const portfolio = candidate.inPortfolio ? '，当前持仓中' : '，未在当前持仓中'
  return `${candidate.name || candidate.code}（${candidate.code}，${market}${portfolio}）`
}

export function buildClarificationQuestion(candidates: AgentClarificationCandidate[], fallback?: string) {
  const labels = candidates.map(candidateLabel).join('；')
  if (fallback && labels) return `${fallback}\n\n我目前能识别到这些候选：${labels}。请直接回复名称、代码，或补充更具体的市场/标的信息。`
  return `我还不能确定你指的是哪一个标的。目前能识别到这些候选：${labels}。请直接回复名称、代码，或补充更具体的市场/标的信息。`
}

function parseJsonObject(raw: string) {
  const normalized = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim()
  return JSON.parse(normalized) as Record<string, unknown>
}

function findCandidate(candidates: AgentClarificationCandidate[], code: unknown, market: unknown, name?: unknown) {
  const normalizedCode = text(code).toUpperCase()
  const normalizedName = text(name)
  const normalizedMarket = isMarket(market) ? market : null
  return candidates.find((candidate) => {
    const codeMatches = normalizedCode && candidate.code.toUpperCase() === normalizedCode
    const nameMatches = normalizedName && candidate.name === normalizedName
    const marketMatches = !normalizedMarket || candidate.market === normalizedMarket
    return marketMatches && (codeMatches || nameMatches)
  }) ?? null
}

function deterministicSelection(userMessage: string, candidates: AgentClarificationCandidate[]) {
  const answer = userMessage.trim()
  const upperAnswer = answer.toUpperCase()

  const exact = candidates.filter((candidate) => {
    return upperAnswer === candidate.code.toUpperCase()
      || answer === candidate.name
      || upperAnswer === `${candidate.code}.${candidate.market}`.toUpperCase()
  })
  if (exact.length === 1) return exact[0]

  const ordinalMap: Array<[RegExp, number]> = [
    [/(第一个|第一只|第1个|第1只|\b1\b)/, 0],
    [/(第二个|第二只|第2个|第2只|\b2\b)/, 1],
    [/(第三个|第三只|第3个|第3只|\b3\b)/, 2],
  ]
  for (const [pattern, index] of ordinalMap) {
    if (pattern.test(answer) && candidates[index]) return candidates[index]
  }

  const marketOnly = candidates.filter((candidate) => {
    if (candidate.market === 'A') return /(A股|A 股|沪深|上交所|深交所)/i.test(answer)
    if (candidate.market === 'HK') return /(港股|香港|港交所|\bHK\b)/i.test(answer)
    if (candidate.market === 'US') return /(美股|美国|纳斯达克|纽交所|\bUS\b|NYSE|NASDAQ)/i.test(answer)
    if (candidate.market === 'FUND') return /(基金|ETF)/i.test(answer)
    if (candidate.market === 'CRYPTO') return /(加密|虚拟货币|数字货币|crypto|币)/i.test(answer)
    return false
  })
  return marketOnly.length === 1 ? marketOnly[0] : null
}

async function resolveViaLlm({
  userMessage,
  pending,
  aiConfig,
}: {
  userMessage: string
  pending: AgentClarificationState
  aiConfig: AiConfig
}): Promise<AgentClarificationResolution | null> {
  if (!aiConfig.enabled || !aiConfig.baseUrl || !aiConfig.model) return null

  const systemPrompt = [
    '你是 StockTracker 的对话澄清解析器，只负责判断用户的新回复是否选择了候选标的。',
    '你必须严格输出 JSON，不要输出解释性文字。',
    '输出格式：',
    '{',
    '  "status": "selected | unclear | new_question",',
    '  "code": "候选代码，仅 selected 时填写",',
    '  "market": "A|HK|US|FUND|CRYPTO，仅 selected 时填写",',
    '  "name": "候选名称，可选",',
    '  "confidence": 0.0-1.0,',
    '  "reason": "简短原因",',
    '  "clarifyQuestion": "需要继续追问时填写"',
    '}',
    '规则：',
    '- 只能从候选列表里选择，不允许编造新标的。',
    '- 只有当用户回复能唯一指向一个候选时，status 才能是 selected。',
    '- 如果用户只回复市场，而该市场下有多个候选，status 必须是 unclear。',
    '- 如果用户没有回答候选，而是在问新的投资问题，status 用 new_question，让主对话继续处理新问题。',
    '- unclear 时用自然语言追问，不要要求 UI 弹选择框。',
  ].join('\n')
  const userPrompt = [
    pending.originalUserMessage ? `上一轮用户问题：${pending.originalUserMessage}` : '',
    pending.question ? `上一轮澄清问题：${pending.question}` : '',
    '',
    '候选标的：',
    ...pending.candidates.map((candidate, index) => `${index + 1}. ${candidateLabel(candidate)}；code=${candidate.code}；market=${candidate.market}`),
    '',
    `用户新回复：${userMessage}`,
  ].filter(Boolean).join('\n')

  const raw = await callJsonCompletion(aiConfig, systemPrompt, userPrompt, AbortSignal.timeout(CLARIFICATION_TIMEOUT_MS))
  const parsed = parseJsonObject(raw)
  const status = text(parsed.status)
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0

  if (status === 'selected') {
    const candidate = findCandidate(pending.candidates, parsed.code, parsed.market, parsed.name)
    if (candidate && confidence >= SELECT_CONFIDENCE_THRESHOLD) {
      return { status: 'selected', candidate, confidence, reason: text(parsed.reason) || undefined }
    }
    return {
      status: 'ask',
      question: buildClarificationQuestion(pending.candidates, text(parsed.clarifyQuestion) || pending.question),
      reason: 'LLM 选择结果置信度不足或未命中候选',
    }
  }

  if (status === 'new_question') {
    return { status: 'new_question', reason: text(parsed.reason) || undefined }
  }

  return {
    status: 'ask',
    question: buildClarificationQuestion(pending.candidates, text(parsed.clarifyQuestion) || pending.question),
    reason: text(parsed.reason) || undefined,
  }
}

export async function resolveClarificationSelection({
  userMessage,
  pending,
  aiConfig,
}: {
  userMessage: string
  pending: AgentClarificationState
  aiConfig: AiConfig
}): Promise<AgentClarificationResolution> {
  const llmResult = await resolveViaLlm({ userMessage, pending, aiConfig }).catch(() => null)
  if (llmResult) return llmResult

  const selected = deterministicSelection(userMessage, pending.candidates)
  if (selected) {
    return { status: 'selected', candidate: selected, confidence: 0.72, reason: 'LLM 不可用时命中明确候选' }
  }

  return {
    status: 'ask',
    question: buildClarificationQuestion(pending.candidates, pending.question),
    reason: '无法唯一识别用户选择的候选标的',
  }
}
