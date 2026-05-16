import { DEFAULT_FEE_CONFIGS, parseMarket } from '@/config/defaults'
import { matchStocks } from '@/lib/agent/entity/stockMatcher'
import { resolveSecurityCandidates } from '@/lib/agent/entity/securityResolver'
import { callJsonCompletion } from '@/lib/external/llmProvider'
import { autoCalcFees, calcStockSummary, estimateDeferredDividendTax, generateId } from '@/lib/finance'
import { getPortfolioByUserId, savePortfolioByUserId } from '@/lib/sqlite/db'
import type { AgentExecutionContext, AgentSkill } from '@/lib/agent/types'
import type { AppConfig, Market, Stock, Trade, TradeType } from '@/types'

export type TradeRecordDraft = {
  type: TradeType
  date: string
  stockId?: string
  code: string
  name: string
  market: Market
  price: number
  quantity: number
  commission: number
  tax: number
  deferredDividendTax?: number
  totalAmount: number
  netAmount: number
  note?: string
  willCreateStock?: boolean
  sourceText: string
  assumptions: string[]
}

type PrepareTradeRecordInput = {
  text?: string
  correctionText?: string
  previousDraft?: TradeRecordDraft
  security?: {
    stockId?: string
    code?: string
    name?: string
    market?: Market
  }
}

type CommitTradeRecordInput = {
  draft?: TradeRecordDraft
}

type ModelTradeExtraction = {
  isTradeRecord?: boolean
  isCancellation?: boolean
  type?: string
  date?: string
  securityQuery?: string
  code?: string
  name?: string
  market?: string
  quantity?: number | string
  price?: number | string
  dividendPerUnit?: number | string
  dividendTotal?: number | string
  note?: string
  assumptions?: string[]
  missing?: string[]
  confidence?: number
}

const TRADE_EXTRACTION_TIMEOUT_MS = 6_000

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function mergeCorrection(input: PrepareTradeRecordInput) {
  const previous = input.previousDraft
  const correction = input.correctionText?.trim()
  if (!previous || !correction) return input.text?.trim() ?? correction ?? ''
  return [
    `${previous.date} ${previous.type === 'BUY' ? '买入' : previous.type === 'SELL' ? '卖出' : '分红'} ${previous.name} ${previous.quantity} 股 ${previous.price} 元`,
    correction,
  ].join('，')
}

function stripJsonFence(raw: string) {
  return raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim()
}

function safeParseModelExtraction(raw: string): ModelTradeExtraction | null {
  try {
    return JSON.parse(stripJsonFence(raw)) as ModelTradeExtraction
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0]) as ModelTradeExtraction
    } catch {
      return null
    }
  }
}

function toNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const normalized = value.replace(/,/g, '').trim()
  if (!normalized) return null
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

function normalizeTradeType(value: unknown): TradeType | null {
  if (value === 'BUY' || value === 'SELL' || value === 'DIVIDEND') return value
  return null
}

function normalizeDate(value: unknown) {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^(20\d{2}|19\d{2})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return value.trim()
}

function compactSecurity(security?: PrepareTradeRecordInput['security']) {
  if (!security) return null
  return {
    stockId: security.stockId,
    code: security.code,
    name: security.name,
    market: security.market,
  }
}

function compactHoldings(stocks: Stock[]) {
  return stocks.slice(0, 80).map((stock) => ({
    stockId: stock.id,
    code: stock.code,
    name: stock.name,
    market: stock.market,
  }))
}

async function extractTradeRecordWithModel(
  text: string,
  args: PrepareTradeRecordInput,
  ctx: AgentExecutionContext,
  stocks: Stock[],
) {
  if (!ctx.aiConfig.enabled || !ctx.aiConfig.baseUrl || !ctx.aiConfig.model || !ctx.aiConfig.apiKey) {
    throw new Error('AI 模型未配置，无法解析交易录入内容。')
  }

  const systemPrompt = [
    '你是 StockTracker 的交易录入抽取器。',
    '你的任务是判断用户文本是否在表达一条要录入系统的交易或分红事实，并抽取结构化字段。',
    '只输出 JSON，不要输出解释文字。',
    '不要根据固定关键词机械判断；要理解整句话的语义、上下文和券商流水式表达。',
    '如果用户是在询问建议、复盘、行情、新闻或假设交易，而不是要求录入事实，isTradeRecord=false。',
    '如果用户是在取消上一条待确认草稿，isCancellation=true。',
    '日期必须归一化为 YYYY-MM-DD；相对日期请按 currentDate 推断。',
    'type 只能是 BUY、SELL、DIVIDEND；买入/申购/加仓为 BUY，卖出/赎回/减仓/清仓为 SELL，现金分红/派息/股息为 DIVIDEND。',
    'price 表示每股/每份成交价；quantity 表示股数/份额/枚数；分红如果只有总额填 dividendTotal，如果有每股/每份金额填 dividendPerUnit。',
    'securityQuery 放用户指向的原始标的名称或代码，不要把价格、数量、日期放进去。',
    'market 如果能从文本或已知证券判断则填 A、HK、US、FUND、CRYPTO，否则为空。',
    '缺失字段放入 missing，不能编造未提供的价格、数量或标的。',
  ].join('\n')

  const userPrompt = JSON.stringify({
    currentDate: localDateString(),
    userText: text,
    correctionText: args.correctionText,
    previousDraft: args.previousDraft
      ? {
          type: args.previousDraft.type,
          date: args.previousDraft.date,
          code: args.previousDraft.code,
          name: args.previousDraft.name,
          market: args.previousDraft.market,
          price: args.previousDraft.price,
          quantity: args.previousDraft.quantity,
        }
      : null,
    plannerSecurity: compactSecurity(args.security),
    currentHoldings: compactHoldings(stocks),
    outputContract: {
      isTradeRecord: 'boolean',
      isCancellation: 'boolean',
      type: 'BUY|SELL|DIVIDEND|null',
      date: 'YYYY-MM-DD|null',
      securityQuery: 'string|null',
      code: 'string|null',
      name: 'string|null',
      market: 'A|HK|US|FUND|CRYPTO|null',
      quantity: 'number|null',
      price: 'number|null',
      dividendPerUnit: 'number|null',
      dividendTotal: 'number|null',
      note: 'string|null',
      assumptions: ['string'],
      missing: ['string'],
      confidence: '0到1',
    },
  })

  const raw = await callJsonCompletion(ctx.aiConfig, systemPrompt, userPrompt, AbortSignal.timeout(TRADE_EXTRACTION_TIMEOUT_MS), {
    reasoningEffort: 'none',
    logFailureLevel: 'warn',
    logMetadata: {
      phase: 'trade.record.extract',
      optional: false,
      timeoutMs: TRADE_EXTRACTION_TIMEOUT_MS,
    },
  })
  const parsed = safeParseModelExtraction(raw)
  if (!parsed) throw new Error('AI 未返回有效的交易录入 JSON。')
  return parsed
}

async function resolveStock(extraction: ModelTradeExtraction, stocks: Stock[], security?: PrepareTradeRecordInput['security']) {
  if (security?.stockId) {
    const stock = stocks.find((item) => item.id === security.stockId)
    if (stock) {
      return {
        query: stock.name,
        candidates: [{
          code: stock.code,
          name: stock.name,
          market: stock.market,
          stockId: stock.id,
          confidence: 1,
          inPortfolio: true,
        }],
      }
    }
  }
  if (security?.code && security.market) {
    const code = security.code.toUpperCase()
    const local = stocks.find((item) => item.code.toUpperCase() === code && item.market === security.market)
    return {
      query: security.name || code,
      candidates: [{
        code,
        name: local?.name ?? security.name ?? code,
        market: security.market,
        stockId: local?.id,
        confidence: local ? 1 : 0.92,
        inPortfolio: Boolean(local),
      }],
    }
  }

  const extractedMarket = parseMarket(extraction.market)
  if (extraction.code && extractedMarket) {
    const code = String(extraction.code).toUpperCase()
    const local = stocks.find((item) => item.code.toUpperCase() === code && item.market === extractedMarket)
    return {
      query: extraction.name || extraction.securityQuery || code,
      candidates: [{
        code,
        name: local?.name ?? extraction.name ?? extraction.securityQuery ?? code,
        market: extractedMarket,
        stockId: local?.id,
        confidence: local ? 1 : 0.9,
        inPortfolio: Boolean(local),
      }],
    }
  }

  const query = [extraction.securityQuery, extraction.name, extraction.code]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find(Boolean) ?? ''
  if (!query) return { query: '', candidates: [] }
  const local = matchStocks(query, stocks, 3).map((match) => ({
    code: match.stock.code,
    name: match.stock.name,
    market: match.stock.market,
    stockId: match.stock.id,
    confidence: match.confidence,
    inPortfolio: true,
  }))
  const marketMatchedLocal = extractedMarket ? local.filter((candidate) => candidate.market === extractedMarket) : local
  if (marketMatchedLocal.length) return { query, candidates: marketMatchedLocal }
  if (local.length) return { query, candidates: local }
  const candidates = await resolveSecurityCandidates(query, stocks, 3)
  const marketMatchedCandidates = extractedMarket ? candidates.filter((candidate) => candidate.market === extractedMarket) : candidates
  return { query, candidates: marketMatchedCandidates.length ? marketMatchedCandidates : candidates }
}

function configForMarket(config: AppConfig | undefined, market: Market) {
  return config?.feeConfigs?.[market] ?? DEFAULT_FEE_CONFIGS[market]
}

function getPayload(ctx: { userId: string; stocks: Stock[] }) {
  const payload = getPortfolioByUserId(ctx.userId)
  return {
    stocks: payload.stocks.length ? payload.stocks : ctx.stocks,
    config: payload.config,
  }
}

function buildMissing(missing: string[], query: string, candidateCount: number) {
  if (!query) missing.push('标的名称或代码')
  if (candidateCount > 1) missing.push('唯一标的')
  return Array.from(new Set(missing))
}

export const tradePrepareRecordSkill: AgentSkill<PrepareTradeRecordInput> = {
  name: 'trade.prepareRecord',
  description: '从用户自然语言中整理买入、卖出或分红记录草稿；只返回待确认数据，不写入数据库。',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      correctionText: { type: 'string' },
      previousDraft: { type: 'object' },
      security: { type: 'object' },
    },
  },
  requiredScopes: ['stock.read', 'trade.read'],
  async execute(args, ctx) {
    const text = mergeCorrection(args)
    if (!text) return { skillName: 'trade.prepareRecord', ok: false, error: '缺少要整理的交易或分红文本' }

    const payload = getPayload(ctx)
    const extraction = await extractTradeRecordWithModel(text, args, ctx, payload.stocks)
    if (extraction.isCancellation) {
      return { skillName: 'trade.prepareRecord', ok: true, data: { status: 'cancelled' } }
    }
    if (extraction.isTradeRecord === false) {
      return {
        skillName: 'trade.prepareRecord',
        ok: true,
        data: {
          status: 'needs_more_info',
          missing: ['交易录入意图'],
          query: '',
          candidates: [],
          sourceText: text,
          message: '这句话不像是在录入一笔交易或分红，请明确说明要录入的交易事实。',
        },
      }
    }

    const type = normalizeTradeType(extraction.type)
    const date = normalizeDate(extraction.date) ?? localDateString()
    const { query, candidates } = await resolveStock(extraction, payload.stocks, args.security)
    const selected = candidates.length === 1 ? candidates[0] : null
    const missing = Array.isArray(extraction.missing) ? extraction.missing.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
    if (!type) missing.push('交易类型（买入/卖出/分红）')

    let quantity = toNumber(extraction.quantity)
    const price = type === 'DIVIDEND'
      ? toNumber(extraction.dividendPerUnit) ?? toNumber(extraction.price)
      : toNumber(extraction.price)
    const dividendTotal = type === 'DIVIDEND' ? toNumber(extraction.dividendTotal) : null
    const heldStock = selected?.stockId ? payload.stocks.find((stock) => stock.id === selected.stockId) : null
    const assumptions = Array.isArray(extraction.assumptions)
      ? extraction.assumptions.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []

    if (type === 'DIVIDEND' && !quantity && heldStock) {
      quantity = calcStockSummary(heldStock).currentHolding
      if (quantity > 0) assumptions.push('分红未说明数量，已按当前持仓数量生成草稿。')
    }

    if (!isFinitePositive(quantity)) missing.push(type === 'DIVIDEND' ? '分红对应数量或当前持仓数量' : '数量')
    if (type === 'DIVIDEND') {
      if (!isFinitePositive(price) && !isFinitePositive(dividendTotal)) missing.push('每股分红或分红总额')
    } else if (!isFinitePositive(price)) {
      missing.push('成交价格')
    }

    const normalizedMissing = buildMissing(missing, query, candidates.length)
    if (!selected || normalizedMissing.length) {
      return {
        skillName: 'trade.prepareRecord',
        ok: true,
        data: {
          status: 'needs_more_info',
          missing: normalizedMissing,
          query,
          candidates,
          sourceText: text,
          message: `还需要补充：${normalizedMissing.join('、')}`,
        },
      }
    }

    const finalType = type
    if (!finalType) return { skillName: 'trade.prepareRecord', ok: false, error: '缺少交易类型，无法生成草稿。' }
    const willCreateStock = !selected.stockId

    const market = selected.market
    const feeConfig = configForMarket(payload.config, market)
    const finalQuantity = quantity as number
    let finalPrice = price ?? 0
    if (finalType === 'DIVIDEND' && !isFinitePositive(finalPrice) && isFinitePositive(dividendTotal)) {
      finalPrice = roundMoney(dividendTotal / finalQuantity)
      assumptions.push('分红只提供总额，已按数量反推单位到账金额。')
    }
    if (willCreateStock) {
      assumptions.push('该标的当前未在持仓中，确认后会先创建持仓，再录入本笔记录。')
    }

    const totalAmount = roundMoney(finalPrice * finalQuantity)
    const baseFees = finalType === 'BUY' || finalType === 'SELL'
      ? autoCalcFees(finalType, finalPrice, finalQuantity, market, selected.code, feeConfig)
      : { commission: 0, tax: 0, netAmount: totalAmount }
    const deferredDividendTax = finalType === 'SELL' && heldStock
      ? estimateDeferredDividendTax(heldStock, date, finalQuantity)
      : 0
    const fees = finalType === 'SELL' && deferredDividendTax > 0
      ? {
          commission: baseFees.commission,
          tax: roundMoney(baseFees.tax + deferredDividendTax),
          netAmount: roundMoney(baseFees.netAmount - deferredDividendTax),
        }
      : baseFees

    const draft: TradeRecordDraft = {
      type: finalType,
      date,
      stockId: selected.stockId,
      code: selected.code,
      name: selected.name,
      market,
      price: finalPrice,
      quantity: finalQuantity,
      commission: fees.commission,
      tax: fees.tax,
      deferredDividendTax: deferredDividendTax > 0 ? deferredDividendTax : undefined,
      totalAmount,
      netAmount: finalType === 'DIVIDEND' ? totalAmount : fees.netAmount,
      note: typeof extraction.note === 'string' && extraction.note.trim() ? extraction.note.trim() : undefined,
      willCreateStock,
      sourceText: text,
      assumptions,
    }

    return {
      skillName: 'trade.prepareRecord',
      ok: true,
      data: {
        status: 'pending_confirmation',
        confirmationRequired: true,
        draft,
        message: '请用户核对草稿，确认无误后才能写入数据库。',
      },
    }
  },
}

function validateDraft(value: unknown): TradeRecordDraft | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Partial<TradeRecordDraft>
  const market = parseMarket(draft.market)
  if (!market) return null
  if (!draft.type || !['BUY', 'SELL', 'DIVIDEND'].includes(draft.type)) return null
  if (!draft.date || !draft.code || !draft.name) return null
  if (!isFinitePositive(draft.price) || !isFinitePositive(draft.quantity)) return null
  return { ...draft, market } as TradeRecordDraft
}

export const tradeCommitRecordSkill: AgentSkill<CommitTradeRecordInput> = {
  name: 'trade.commitRecord',
  description: '在用户明确确认后，将已确认的买入、卖出或分红草稿写入本地数据库。',
  inputSchema: {
    type: 'object',
    properties: {
      draft: { type: 'object' },
    },
    required: ['draft'],
  },
  requiredScopes: ['trade.write', 'stock.read'],
  async execute(args, ctx) {
    const draft = validateDraft(args.draft)
    if (!draft) return { skillName: 'trade.commitRecord', ok: false, error: '待写入草稿无效，无法录入。' }

    const payload = getPortfolioByUserId(ctx.userId)
    const now = new Date().toISOString()
    let targetStock = payload.stocks.find((stock) => stock.id === draft.stockId)
      ?? payload.stocks.find((stock) => stock.code.toUpperCase() === draft.code.toUpperCase() && stock.market === draft.market)

    const trade: Trade = {
      id: generateId(),
      stockId: targetStock?.id ?? generateId(),
      type: draft.type,
      date: draft.date,
      price: draft.price,
      quantity: draft.quantity,
      commission: draft.commission,
      tax: draft.tax,
      deferredDividendTax: draft.deferredDividendTax,
      totalAmount: draft.totalAmount,
      netAmount: draft.netAmount,
      note: draft.note,
      createdAt: now,
      updatedAt: now,
    }

    let nextStocks: Stock[]
    if (targetStock) {
      trade.stockId = targetStock.id
      nextStocks = payload.stocks.map((stock) => stock.id === targetStock?.id
        ? { ...stock, updatedAt: now, trades: [...stock.trades, trade].sort((a, b) => a.date.localeCompare(b.date)) }
        : stock)
    } else {
      targetStock = {
        id: trade.stockId,
        code: draft.code,
        name: draft.name,
        market: draft.market,
        trades: [trade],
        createdAt: now,
        updatedAt: now,
      }
      nextStocks = [...payload.stocks, targetStock]
    }

    savePortfolioByUserId(ctx.userId, {
      stocks: nextStocks,
      config: payload.config,
    })

    return {
      skillName: 'trade.commitRecord',
      ok: true,
      data: {
        status: 'recorded',
        stockCreated: !draft.stockId,
        stock: {
          id: targetStock.id,
          code: targetStock.code,
          name: targetStock.name,
          market: targetStock.market,
        },
        trade: {
          id: trade.id,
          type: trade.type,
          date: trade.date,
          price: trade.price,
          quantity: trade.quantity,
          commission: trade.commission,
          tax: trade.tax,
          totalAmount: trade.totalAmount,
          netAmount: trade.netAmount,
        },
      },
    }
  },
}
