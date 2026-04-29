import { calcStockSummary, generateId } from '@/lib/finance'
import { stockPriceService } from '@/lib/StockPriceService'
import type { AiChatContextStats, AiChatMessage, AiConfig, Market, Stock } from '@/types'
import type { StockQuote } from '@/types/stockApi'

export type ProviderMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ExternalStockRequest = {
  symbol: string
  market: Market
}

export type ChatContextBuildResult = {
  messages: ProviderMessage[]
  contextSnapshot: Record<string, unknown>
  stats: AiChatContextStats
}

const VALID_MARKETS: Market[] = ['A', 'HK', 'US', 'FUND', 'CRYPTO']
const ANTHROPIC_CHAT_RESPONSE_TOKEN_LIMIT = 4096
export const AI_CHAT_TITLE_MAX_LENGTH = 24

export function validateAiChatConfig(config: AiConfig) {
  if (!config.enabled) throw new Error('AI 功能尚未启用')
  if (!config.baseUrl.trim()) throw new Error('请先配置 AI Base URL')
  if (!config.model.trim()) throw new Error('请先配置 AI 模型')
  if (!config.apiKey.trim()) throw new Error('请先配置 AI API Key')
}

export function estimateTokens(input: string) {
  const ascii = input.match(/[\x00-\x7F]+/g)?.join(' ') ?? ''
  const nonAsciiCount = input.length - ascii.length
  const englishLikeTokens = ascii.trim() ? ascii.trim().split(/\s+/).length : 0
  return Math.max(1, Math.ceil(nonAsciiCount * 0.9 + englishLikeTokens * 1.35))
}

export function getContextStats(tokenEstimate: number, maxContextTokens: number): AiChatContextStats {
  const max = Math.max(4096, maxContextTokens || 128000)
  const ratio = tokenEstimate / max
  const level: AiChatContextStats['level'] =
    ratio >= 0.85 ? 'near-limit' : ratio >= 0.55 ? 'long' : ratio >= 0.25 ? 'medium' : 'short'
  return { tokenEstimate, maxContextTokens: max, level }
}

export function getContextLevelLabel(level: AiChatContextStats['level']) {
  const labels: Record<AiChatContextStats['level'], string> = {
    short: '短',
    medium: '中',
    long: '长',
    'near-limit': '接近上限',
  }
  return labels[level]
}

export function buildChatTitle(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (!normalized) return '新对话'
  return normalized.length > AI_CHAT_TITLE_MAX_LENGTH ? `${normalized.slice(0, AI_CHAT_TITLE_MAX_LENGTH - 1)}…` : normalized
}

export function normalizeChatTitle(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (!normalized) return '新对话'
  return normalized.length > AI_CHAT_TITLE_MAX_LENGTH ? normalized.slice(0, AI_CHAT_TITLE_MAX_LENGTH) : normalized
}

function ensureApiBase(baseUrl: string, provider: AiConfig['provider']) {
  const normalized = baseUrl.replace(/\/$/, '')
  if (!normalized) throw new Error('请先配置 AI Base URL')
  if (provider === 'openai-compatible') {
    return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
  }
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}

function quoteToContext(quote: StockQuote | null) {
  if (!quote) return null
  return {
    symbol: quote.symbol,
    name: quote.name,
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
    peTtm: quote.peTtm ?? null,
    epsTtm: quote.epsTtm ?? null,
    pb: quote.pb ?? null,
    marketCap: quote.marketCap ?? null,
    currency: quote.currency,
    source: quote.source,
    valuationSource: quote.valuationSource ?? null,
    timestamp: quote.timestamp,
  }
}

function buildHoldingContext(stocks: Stock[]) {
  return stocks.map((stock) => {
    const summary = calcStockSummary(stock)
    return {
      id: stock.id,
      code: stock.code,
      name: stock.name,
      market: stock.market,
      note: stock.note ?? '',
      quote: null,
      dataSource: 'local',
      summary: {
        currentHolding: summary.currentHolding,
        avgCostPrice: summary.avgCostPrice,
        realizedPnl: summary.realizedPnl,
        unrealizedPnl: summary.unrealizedPnl,
        totalPnl: summary.totalPnl,
        totalPnlPercent: summary.totalPnlPercent,
        totalCommission: summary.totalCommission,
        totalDividend: summary.totalDividend,
        tradeCount: summary.tradeCount,
      },
      recentTrades: stock.trades.slice(-8).map((trade) => ({
        type: trade.type,
        date: trade.date,
        price: trade.price,
        quantity: trade.quantity,
        commission: trade.commission,
        tax: trade.tax,
        netAmount: trade.netAmount,
        note: trade.note ?? '',
      })),
    }
  })
}

async function buildExternalStockContext(externalStocks: ExternalStockRequest[]) {
  const unique = externalStocks
    .filter((item) => item.symbol.trim() && VALID_MARKETS.includes(item.market))
    .filter((item, index, array) => array.findIndex((candidate) => candidate.symbol === item.symbol && candidate.market === item.market) === index)

  return Promise.all(
    unique.map(async (item) => {
      const quote = await stockPriceService.getQuote(item.symbol, item.market).catch(() => null)
      return {
        symbol: item.symbol,
        market: item.market,
        inPortfolio: false,
        quote: quoteToContext(quote),
      }
    }),
  )
}

function buildSystemPrompt(language: AiConfig['analysisLanguage']) {
  return [
    '你是 StockTracker 内置的个人理财专家，服务对象是正在管理自己股票、基金、港股、美股、A 股或加密资产记录的个人投资者。',
    '你只能回答与用户当前持仓、用户明确提到的股票、交易记录、股票基础数据、估值、行情、风险、仓位、复盘和资产配置有关的问题。',
    '如果用户询问与股票投资无关的内容，你必须礼貌拒绝，并引导用户回到持仓、交易复盘、股票估值、行情或风险管理相关问题。',
    '你可以基于系统提供的持仓数据、交易记录、盈亏摘要、个股基础数据、技术指标，以及系统为未持仓股票自动抓取到的可用数据进行分析。',
    '你不能编造系统未提供的数据；如果数据不足，必须明确说明。',
    '你不能承诺收益，不能声称确定涨跌，不能提供内幕消息，不能把回答包装成绝对买卖指令。',
    '回答需要具体、直接、可执行，但不要在每次回复中输出免责声明、风险提示模板或“仅供参考，不构成投资建议”之类的固定结尾；这些边界由界面中的固定提醒承担。',
    `默认输出语言：${language === 'en-US' ? 'English' : '中文'}`,
  ].join('\n')
}

function buildContextPrompt(contextSnapshot: Record<string, unknown>) {
  return [
    '以下是系统可用的投资上下文。请优先基于这些事实回答，不要编造缺失数据。',
    '如果 externalStocks 中有数据，它们是用户询问但未在当前持仓中的标的，请明确说明“未在当前持仓中”。',
    JSON.stringify(contextSnapshot),
  ].join('\n\n')
}

function compactHistory(messages: AiChatMessage[], maxHistoryTokens: number) {
  const compacted: ProviderMessage[] = []
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

function normalizeStreamContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(normalizeStreamContent).join('')
  if (!value || typeof value !== 'object') return ''

  const part = value as Record<string, unknown>
  if (typeof part.text === 'string') return part.text
  if (typeof part.content === 'string') return part.content
  if (Array.isArray(part.content)) return part.content.map(normalizeStreamContent).join('')
  return ''
}

function extractOpenAiStreamText(choice: unknown): string {
  if (!choice || typeof choice !== 'object') return ''

  const item = choice as Record<string, unknown>
  const delta = item.delta && typeof item.delta === 'object' ? (item.delta as Record<string, unknown>) : null
  const message = item.message && typeof item.message === 'object' ? (item.message as Record<string, unknown>) : null
  const candidates = [delta?.content, delta?.text, message?.content, item.text]

  return candidates.map(normalizeStreamContent).join('')
}

function getProviderErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const payload = error as Record<string, unknown>
  if (typeof payload.message === 'string') return payload.message
  if (typeof payload.error === 'string') return payload.error
  if (payload.error && typeof payload.error === 'object') {
    const nested = payload.error as Record<string, unknown>
    if (typeof nested.message === 'string') return nested.message
  }
  return null
}

function parseStreamPayload(data: string) {
  try {
    return JSON.parse(data)
  } catch {
    throw new Error('LLM 返回了无法解析的流式数据')
  }
}

function assertNormalFinish(finishReason: string | null, receivedText: boolean, onChunk: (chunk: string) => void) {
  if (!finishReason) {
    if (receivedText) {
      console.warn('[ai-chat] stream ended without finish_reason')
      return
    }
    throw new Error('AI 未返回有效内容')
  }

  if (['stop', 'end_turn', 'complete'].includes(finishReason)) return

  if (['length', 'max_tokens'].includes(finishReason)) {
    if (receivedText) {
      onChunk('\n\n（本次回复已达到模型单次输出上限，后续内容停止生成。可以拆成更具体的问题继续追问。）')
      return
    }
    throw new Error('AI 回复达到模型单次输出上限，未返回有效内容。请缩小问题范围后重试。')
  }

  if (['content_filter', 'safety', 'blocked'].includes(finishReason)) {
    throw new Error('AI 回复被安全策略提前终止，请调整问题后重试。')
  }

  throw new Error(`AI 回复被提前终止：${finishReason}`)
}

export async function buildChatContext({
  aiConfig,
  stocks,
  history,
  userMessage,
  externalStocks,
}: {
  aiConfig: AiConfig
  stocks: Stock[]
  history: AiChatMessage[]
  userMessage: string
  externalStocks: ExternalStockRequest[]
}): Promise<ChatContextBuildResult> {
  const holdings = buildHoldingContext(stocks)
  const external = await buildExternalStockContext(externalStocks)
  const contextSnapshot = {
    generatedAt: new Date().toISOString(),
    holdings,
    externalStocks: external,
  }
  const system = buildSystemPrompt(aiConfig.analysisLanguage)
  const context = buildContextPrompt(contextSnapshot)
  const maxContextTokens = Math.max(4096, aiConfig.maxContextTokens || 128000)
  const reserved = estimateTokens(system) + estimateTokens(context) + estimateTokens(userMessage) + 1024
  const historyBudget = Math.max(0, maxContextTokens - reserved)
  const messages: ProviderMessage[] = [
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

async function streamOpenAiCompatible(config: AiConfig, messages: ProviderMessage[], onChunk: (chunk: string) => void) {
  const baseUrl = ensureApiBase(config.baseUrl, config.provider)
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      stream: true,
      messages,
    }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text()
    throw new Error(`LLM 请求失败 (${res.status}): ${text.slice(0, 200)}`)
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let finishReason: string | null = null
  let receivedText = false
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue
      const payload = parseStreamPayload(data)
      const providerError = getProviderErrorMessage(payload?.error)
      if (providerError) throw new Error(`LLM 流式返回错误：${providerError}`)

      const choice = payload?.choices?.[0]
      if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason

      const text = extractOpenAiStreamText(choice)
      if (text) {
        receivedText = true
        onChunk(text)
      }
    }
  }

  assertNormalFinish(finishReason, receivedText, onChunk)
}

async function streamAnthropicCompatible(config: AiConfig, messages: ProviderMessage[], onChunk: (chunk: string) => void) {
  const baseUrl = ensureApiBase(config.baseUrl, config.provider)
  const system = messages.find((message) => message.role === 'system')?.content ?? ''
  const rest = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    }))

  const res = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      system,
      temperature: config.temperature,
      max_tokens: ANTHROPIC_CHAT_RESPONSE_TOKEN_LIMIT,
      stream: true,
      messages: rest,
    }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text()
    throw new Error(`LLM 请求失败 (${res.status}): ${text.slice(0, 200)}`)
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let finishReason: string | null = null
  let receivedText = false
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data) continue
      const payload = parseStreamPayload(data)
      const providerError = getProviderErrorMessage(payload?.error)
      if (providerError) throw new Error(`LLM 流式返回错误：${providerError}`)

      const text = payload?.delta?.text
      if (typeof text === 'string') {
        receivedText = true
        onChunk(text)
      }
      if (typeof payload?.delta?.stop_reason === 'string') finishReason = payload.delta.stop_reason
    }
  }

  assertNormalFinish(finishReason, receivedText, onChunk)
}

export async function streamChatCompletion(config: AiConfig, messages: ProviderMessage[], onChunk: (chunk: string) => void) {
  if (config.provider === 'anthropic-compatible') {
    await streamAnthropicCompatible(config, messages, onChunk)
    return
  }
  await streamOpenAiCompatible(config, messages, onChunk)
}

export function createChatMessageId() {
  return generateId()
}
